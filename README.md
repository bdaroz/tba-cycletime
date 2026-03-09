# Cycletime Analysis

This app queries the TBA API (`api_v3.json` spec file) for a list of all current season events and analyses match cycle
time information from the API. Caching is implemented aggressively for performance.

The app presents the user three general web pages using this data:
1. The main page - a general summary of cycle times across *all* events this year\*.
2. The list of events and their average cycle time.
3. A detailed per-event page breaking down each match, cycle times, and graphs.

\* - Note only events that have at least 20% of all qualification matches complete are listed.

Note, this app is designed to be run locally, no security or authentication is required. A dark-mode theme is preferred.

## Data Caching

The following data is cached locally in-file-system between runs:
- List of events in the current season
- Match information for all events that have completed all qualification matches

All other API calls are cached in-memory.

## Cycle Time Definitions.

The TBA API provides, for each event, a list of all matches. In that structure there are several pieces of raw data
of interest:
- `comp_level` - we only analyze Qualification matches or `qm` level.
- `match_number` - the cardinal indexed number of the match
- `time` - UNIX Timestamp value of the scheduled match start time.
- `actual_time` - UNIX Timestamp value of the actual match start time. (The difference from `time` denotes how
  far +- an event is running at that point from the published schedule)
- `post_result_time` - UNIX Timestamp of the time the score is posted.

For 2026, a match cycle starts with `actual_time` and proceeds through a 20 second autonomous period, a 3 second
transition period, followed by 2 minutes and 20 seconds of play for a total of 2 minutes and 43 seconds of match time.

The difference between the `actual_time` plus the match time above, and the `post_result_time` is the time the referees
spend scoring and finalizing the match.

The field is then reset for the next match and the cycle restarts with the next `actual_time`. Thus one cycle is from
`actual_time` to `actual_time` of the next match number in sequence at that event.

## Analysis

At a match level we need to know the cycle time from the previous match to the current match. The first match of each
day is excluded from cycle time analysis. We also need to know the amount of time spent by referees. Finally, for each
match how far ahead/behind the scheduled time the match started.

At an event level, we would like to see both cycle time and referee time over the course of the event, as well as
min/max/average of each. Additionally the amount of time ahead/behind the schedule as it progresses over the event.

At a season level the min/avg/max cycle times per event, and an overall min/avg/max of all matches across all events.

Liberal use of graphs are encouraged.

## Configuration

Two settings are needed in a configuration file:
- Cache directory (to store file-system level caches)
- TBA API Key