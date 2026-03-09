const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

const CACHE_DIR = config.cacheDir;
const TBA_API_KEY = config.tbaApiKey;
const BASE_URL = 'https://www.thebluealliance.com/api/v3';

// Ensure cache directory exists
fs.ensureDirSync(CACHE_DIR);

const memoryCache = {};

async function get(endpoint, cacheToFile = false) {
  if (memoryCache[endpoint]) {
    return memoryCache[endpoint];
  }

  const cacheFilePath = path.join(CACHE_DIR, endpoint.replace(/\//g, '_') + '.json');

  if (cacheToFile && await fs.pathExists(cacheFilePath)) {
    const data = await fs.readJson(cacheFilePath);
    memoryCache[endpoint] = data;
    return data;
  }

  try {
    const response = await axios.get(`${BASE_URL}${endpoint}`, {
      headers: {
        'X-TBA-Auth-Key': TBA_API_KEY,
        'If-None-Match': memoryCache[endpoint + '_etag'] // Optional: Use ETag for caching if supported
      },
    });

    const data = response.data;
    memoryCache[endpoint] = data;
    // memoryCache[endpoint + '_etag'] = response.headers['etag'];

    if (cacheToFile) {
      await fs.writeJson(cacheFilePath, data);
    }

    return data;
  } catch (error) {
    if (error.response && error.response.status === 304) {
        return memoryCache[endpoint];
    }
    console.error(`Error fetching ${endpoint}:`, error.message);
    throw error;
  }
}

async function getEvents(year) {
  return get(`/events/${year}`, true);
}

async function getMatches(eventKey) {
  // Check if we have a cached file for this event's matches
  const cacheFilePath = path.join(CACHE_DIR, `/event/${eventKey}/matches`.replace(/\//g, '_') + '.json');
  
  if (await fs.pathExists(cacheFilePath)) {
      const data = await fs.readJson(cacheFilePath);
      memoryCache[`/event/${eventKey}/matches`] = data;
      return data;
  }

  // If not cached, fetch from API
  const matches = await get(`/event/${eventKey}/matches`);
  
  // Check if the event is complete (all qualification matches played)
  // This is a heuristic. We can check if the last match has a result.
  const qmMatches = matches.filter(m => m.comp_level === 'qm');
  const allPlayed = qmMatches.every(m => m.actual_time && m.post_result_time);
  
  if (allPlayed && qmMatches.length > 0) {
      // Cache to file if all qualification matches are complete
      await fs.writeJson(cacheFilePath, matches);
  }
  
  return matches;
}

async function getEvent(eventKey) {
    return get(`/event/${eventKey}`, true);
}

module.exports = {
  getEvents,
  getMatches,
  getEvent
};
