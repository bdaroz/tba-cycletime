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
  
  // Check if matches have actual_time (started)
  const startedMatches = qmMatches.filter(m => m.actual_time);
  
  // If less than 20% started, not eligible
  return (startedMatches.length / qmMatches.length) >= 0.2;
}

async function getEligibleEventsWithStats(year) {
  const events = await tbaService.getEvents(year);
  const eligibleEvents = [];
  let allCycleTimes = [];
  let allRefTimes = [];
  let allScheduleDiffs = [];

  // Filter events that have started or ended
  const today = moment();
  const potentialEvents = events.filter(e => {
      if (e.event_type === 100) return false; // Filter out event_type 100
      if (!e.start_date) return false;
      const startDate = moment(e.start_date);
      return startDate.isSameOrBefore(today);
  });

  // Process in batches to avoid rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < potentialEvents.length; i += BATCH_SIZE) {
      const batch = potentialEvents.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (event) => {
          try {
              const matches = await tbaService.getMatches(event.key);
              if (isEventEligible(matches)) {
                  const analysisResult = analysis.analyzeMatches(matches);
                  
                  // Filter outliers for event stats
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
                  
                  // Add event context to each item for season-wide stats
                  // Note: We use the filtered lists here to avoid polluting season stats with outliers
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

  // Filter outliers again for season stats? 
  // Or assume event-level filtering is enough?
  // The requirement says "exclude from display or calculation any individual data points that are off by more then 2 standard deviations."
  // If we filter at event level, we might still have outliers at season level if events vary wildly.
  // But usually "outlier" is relative to the dataset.
  // Let's filter at season level too for the season summary.
  
  const seasonStats = {
      cycle: analysis.calculateStats(analysis.filterOutliers(allCycleTimes)),
      ref: analysis.calculateStats(analysis.filterOutliers(allRefTimes)),
      schedule: analysis.calculateStats(analysis.filterOutliers(allScheduleDiffs))
  };

  return { eligibleEvents, seasonStats };
}

// Cache the result of getEligibleEventsWithStats to avoid re-fetching on every request
let cachedStats = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

app.get('/', async (req, res) => {
  try {
    const now = Date.now();
    if (!cachedStats || (now - lastFetchTime > CACHE_DURATION)) {
        cachedStats = await getEligibleEventsWithStats(config.year);
        lastFetchTime = now;
    }
    
    res.render('index', { 
        events: cachedStats.eligibleEvents, 
        seasonStats: cachedStats.seasonStats 
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error fetching events');
  }
});

app.get('/events', async (req, res) => {
  try {
      // Reuse the cached stats if available, otherwise fetch
      const now = Date.now();
      if (!cachedStats || (now - lastFetchTime > CACHE_DURATION)) {
          cachedStats = await getEligibleEventsWithStats(config.year);
          lastFetchTime = now;
      }
      res.render('events', { events: cachedStats.eligibleEvents });
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
    
    // Filter outliers for this event
    const filteredCycleTimes = analysis.filterOutliers(analysisResult.cycleTimes);
    const filteredRefTimes = analysis.filterOutliers(analysisResult.refereeTimes);
    const filteredScheduleDiffs = analysis.filterOutliers(analysisResult.scheduleDiffs);

    const cycleStats = analysis.calculateStats(filteredCycleTimes);
    const refStats = analysis.calculateStats(filteredRefTimes);
    const scheduleStats = analysis.calculateStats(filteredScheduleDiffs);
    
    const dailyTotalScheduleDelta = analysis.calculateDailyTotalScheduleDelta(matches);

    // Prepare match details for the table
    const qmMatches = matches.filter(m => m.comp_level === 'qm').sort((a, b) => a.match_number - b.match_number);
    const matchDetails = qmMatches.map(match => {
        const cycleTimeItem = analysisResult.cycleTimes.find(item => item.match.key === match.key);
        const refTimeItem = analysisResult.refereeTimes.find(item => item.match.key === match.key);
        const scheduleDiffItem = analysisResult.scheduleDiffs.find(item => item.match.key === match.key);

        // Check if items are in the filtered lists to mark them or exclude them?
        // Requirement: "exclude from display or calculation"
        // If we exclude from display, the table might have holes.
        // Let's just show them as null or exclude the row?
        // "exclude from display" usually means don't show the value.
        
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

    // Pass filtered data for charts
    const chartData = {
        cycleTimes: filteredCycleTimes,
        refereeTimes: filteredRefTimes,
        scheduleDiffs: filteredScheduleDiffs
    };

    res.render('event', {
      event,
      matches,
      analysisResult: chartData, // Pass filtered data for charts
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
