const moment = require('moment');

function analyzeMatches(matches) {
  // Filter for Qualification matches
  const qmMatches = matches.filter(m => m.comp_level === 'qm');

  // Sort by match number
  qmMatches.sort((a, b) => a.match_number - b.match_number);

  const cycleTimes = [];
  const refereeTimes = [];
  const scheduleDiffs = [];

  for (let i = 0; i < qmMatches.length; i++) {
    const match = qmMatches[i];
    const prevMatch = i > 0 ? qmMatches[i - 1] : null;

    // Calculate schedule difference
    if (match.actual_time && match.time) {
      const diff = match.actual_time - match.time;
      scheduleDiffs.push({ value: diff, match });
    }

    // Calculate referee time
    if (match.actual_time && match.post_result_time) {
      // Match time is 2:43 = 163 seconds
      const matchTime = 163;
      const refTime = match.post_result_time - (match.actual_time + matchTime);
      refereeTimes.push({ value: refTime, match });
    }

    // Calculate cycle time
    if (prevMatch && prevMatch.actual_time && match.actual_time) {
      const prevDate = moment.unix(prevMatch.actual_time).format('YYYY-MM-DD');
      const currDate = moment.unix(match.actual_time).format('YYYY-MM-DD');

      if (prevDate === currDate) {
        const cycleTime = match.actual_time - prevMatch.actual_time;
        cycleTimes.push({ value: cycleTime, match });
      }
    }
  }

  return {
    cycleTimes,
    refereeTimes,
    scheduleDiffs,
    matchCount: qmMatches.length,
    qmMatches // Return sorted matches for further analysis
  };
}

function calculateDailyTotalScheduleDelta(matches) {
    // Filter for Qualification matches and sort
    const qmMatches = matches.filter(m => m.comp_level === 'qm').sort((a, b) => a.match_number - b.match_number);
    
    if (qmMatches.length === 0) return 0;

    const matchesByDay = {};
    
    qmMatches.forEach(match => {
        if (match.actual_time) {
            const date = moment.unix(match.actual_time).format('YYYY-MM-DD');
            if (!matchesByDay[date]) {
                matchesByDay[date] = [];
            }
            matchesByDay[date].push(match);
        }
    });

    let totalDelta = 0;

    for (const date in matchesByDay) {
        const dailyMatches = matchesByDay[date];
        // Sort by match number to find the last one
        dailyMatches.sort((a, b) => a.match_number - b.match_number);
        const lastMatch = dailyMatches[dailyMatches.length - 1];
        
        if (lastMatch.actual_time && lastMatch.time) {
            totalDelta += (lastMatch.actual_time - lastMatch.time);
        }
    }

    return totalDelta;
}

function calculateStandardDeviation(items) {
    const values = items.map(i => i.value);
    if (values.length < 2) return { mean: 0, stdDev: 0 };
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const stdDev = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / n);
    return { mean, stdDev };
}

function filterOutliers(items) {
    if (items.length < 2) return items;
    const { mean, stdDev } = calculateStandardDeviation(items);
    const lowerBound = mean - 2 * stdDev;
    const upperBound = mean + 2 * stdDev;
    return items.filter(item => item.value >= lowerBound && item.value <= upperBound);
}

function calculateStats(items) {
  if (items.length === 0) {
    return { 
        min: { value: 0, context: null }, 
        max: { value: 0, context: null }, 
        avg: 0 
    };
  }
  
  let minItem = items[0];
  let maxItem = items[0];
  let sum = 0;

  for (const item of items) {
      if (item.value < minItem.value) minItem = item;
      if (item.value > maxItem.value) maxItem = item;
      sum += item.value;
  }
  
  const avg = sum / items.length;
  
  return { 
      min: { value: minItem.value, context: minItem.context || minItem }, 
      max: { value: maxItem.value, context: maxItem.context || maxItem }, 
      avg 
  };
}

module.exports = {
  analyzeMatches,
  calculateStats,
  filterOutliers,
  calculateDailyTotalScheduleDelta
};
