const express = require('express');
const path = require('path');
const moment = require('moment');
const tbaService = require('./tbaService');
const analysis = require('./analysis');
const config = require('../config');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));
app.use(express.static(path.join(__dirname, '../public')));

// Helper to check if event is eligible (20% matches complete)
function isEventEligible(matches) {
  const qmMatches = matches.filter(m => m.comp_level === 'qm');
  if (qmMatches.length === 0) return false;
  
  const startedMatches = qmMatches.filter(m => m.actual_time);
  
  return (startedMatches.length / qmMatches.length) >= 0.2;
}

async function getEligibleEventsWithStats(year, weekFilter = null) {
  let events = await tbaService.getEvents(year);
  const eligibleEvents = [];
  let allCycleTimes = [];
  let allRefTimes = [];
  let allScheduleDiffs = [];

  // Filter by week if a filter is provided
  if (weekFilter !== null) {
      events = events.filter(e => e.week === weekFilter);
  }

  const today = moment();
  const potentialEvents = events.filter(e => {
      if (e.event_type === 100) return false;
      if (!e.start_date) return false;
      const startDate = moment(e.start_date);
      return startDate.isSameOrBefore(today);
  });

  const BATCH_SIZE = 5;
  for (let i = 0; i < potentialEvents.length; i += BATCH_SIZE) {
      const batch = potentialEvents.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (event) => {
          try {
              const matches = await tbaService.getMatches(event.key);
              if (isEventEligible(matches)) {
                  const analysisResult = analysis.analyzeMatches(matches);
                  
                  const filteredCycleTimes = analysis.filterOutliers(analysisResult.cycleTimes);
                  const filteredRefTimes = analysis.filterOutliers(analysisResult.refereeTimes);
                  const filteredScheduleDiffs = analysis.filterOutliers(analysisResult.scheduleDiffs);

                  const dailyTotalScheduleDelta = analysis.calculateDailyTotalScheduleDelta(matches);

                  const eventStats = {
                      ...event,
                      avgCycleTime: analysis.calculateStats(filteredCycleTimes).avg,
                      avgRefTime: analysis.calculateStats(filteredRefTimes).avg,
                      avgScheduleDiff: analysis.calculateStats(filteredScheduleDiffs).avg,
                      dailyTotalScheduleDelta
                  };
                  eligibleEvents.push(eventStats);
                  
                  const cycleTimesWithEvent = filteredCycleTimes.map(item => ({ ...item, event }));
                  const refTimesWithEvent = filteredRefTimes.map(item => ({ ...item, event }));
                  const scheduleDiffsWithEvent = filteredScheduleDiffs.map(item => ({ ...item, event }));

                  allCycleTimes = allCycleTimes.concat(cycleTimesWithEvent);
                  allRefTimes = allRefTimes.concat(refTimesWithEvent);
                  allScheduleDiffs = allScheduleDiffs.concat(scheduleDiffsWithEvent);
              }
          } catch (e) {
              console.error(`Error processing event ${event.key}:`, e.message);
          }
      }));
  }
  
  const summaryStats = {
      cycle: analysis.calculateStats(analysis.filterOutliers(allCycleTimes)),
      ref: analysis.calculateStats(analysis.filterOutliers(allRefTimes)),
      schedule: analysis.calculateStats(analysis.filterOutliers(allScheduleDiffs))
  };

  return { eligibleEvents, summaryStats };
}

let cachedStats = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

async function getAndCacheStats() {
    const now = Date.now();
    if (!cachedStats || (now - lastFetchTime > CACHE_DURATION)) {
        const { eligibleEvents, summaryStats } = await getEligibleEventsWithStats(config.year);
        const weeks = [...new Set(eligibleEvents.map(e => e.week))].sort((a, b) => a - b);
        
        cachedStats = {
            eligibleEvents,
            seasonStats: summaryStats,
            weeks
        };
        lastFetchTime = now;
    }
    return cachedStats;
}

app.get('/', async (req, res) => {
  try {
    const stats = await getAndCacheStats();
    res.render('index', { 
        events: stats.eligibleEvents, 
        seasonStats: stats.seasonStats,
        weeks: stats.weeks
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching events');
  }
});

app.get('/week/:weekNumber', async (req, res) => {
    try {
        const weekNumber = parseInt(req.params.weekNumber, 10);
        const { eligibleEvents, summaryStats } = await getEligibleEventsWithStats(config.year, weekNumber);
        
        res.render('week', {
            events: eligibleEvents,
            weekStats: summaryStats,
            weekNumber: weekNumber
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error fetching week details');
    }
});

app.get('/events', async (req, res) => {
  try {
      const stats = await getAndCacheStats();
      res.render('events', { 
          events: stats.eligibleEvents,
          weeks: stats.weeks
      });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching events');
  }
});

app.get('/event/:eventKey', async (req, res) => {
  try {
    const eventKey = req.params.eventKey;
    const event = await tbaService.getEvent(eventKey);
    const matches = await tbaService.getMatches(eventKey);
    const analysisResult = analysis.analyzeMatches(matches);
    
    const filteredCycleTimes = analysis.filterOutliers(analysisResult.cycleTimes);
    const filteredRefTimes = analysis.filterOutliers(analysisResult.refereeTimes);
    const filteredScheduleDiffs = analysis.filterOutliers(analysisResult.scheduleDiffs);

    const cycleStats = analysis.calculateStats(filteredCycleTimes);
    const refStats = analysis.calculateStats(filteredRefTimes);
    const scheduleStats = analysis.calculateStats(filteredScheduleDiffs);
    
    const dailyTotalScheduleDelta = analysis.calculateDailyTotalScheduleDelta(matches);

    const qmMatches = matches.filter(m => m.comp_level === 'qm').sort((a, b) => a.match_number - b.match_number);
    const matchDetails = qmMatches.map(match => {
        const cycleTimeItem = analysisResult.cycleTimes.find(item => item.match.key === match.key);
        const refTimeItem = analysisResult.refereeTimes.find(item => item.match.key === match.key);
        const scheduleDiffItem = analysisResult.scheduleDiffs.find(item => item.match.key === match.key);
        
        const isCycleOutlier = cycleTimeItem && !filteredCycleTimes.includes(cycleTimeItem);
        const isRefOutlier = refTimeItem && !filteredRefTimes.includes(refTimeItem);
        const isScheduleOutlier = scheduleDiffItem && !filteredScheduleDiffs.includes(scheduleDiffItem);

        return {
            match_number: match.match_number,
            scheduled_time: match.time,
            actual_time: match.actual_time,
            post_result_time: match.post_result_time,
            cycle_time: (cycleTimeItem && !isCycleOutlier) ? cycleTimeItem.value : null,
            ref_time: (refTimeItem && !isRefOutlier) ? refTimeItem.value : null,
            schedule_diff: (scheduleDiffItem && !isScheduleOutlier) ? scheduleDiffItem.value : null
        };
    });

    const chartData = {
        cycleTimes: filteredCycleTimes,
        refereeTimes: filteredRefTimes,
        scheduleDiffs: filteredScheduleDiffs
    };

    res.render('event', {
      event,
      analysisResult: chartData,
      cycleStats,
      refStats,
      scheduleStats,
      matchDetails,
      dailyTotalScheduleDelta
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching event details');
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
