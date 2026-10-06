# Naver post-level daily statistics

Keep this Site owner-private. Use Sites get_site to verify owner and sole-owner custom access. Send its short-lived service token only to the exact Site origin as OAI-Sites-Authorization, using hidden stdin and session memory. Browser callers additionally require the administrator session. This route is behind Sites private dispatch; never expose the Worker publicly.

## Verified Naver paths

The saved TinyFish profile prof_a489202b56da4c6b successfully accessed blog statistics on 2026-10-06. Ranking: https://admin.blog.naver.com/withsuzz/stat/rank_pv. A post-specific daily analysis is https://blog.stat.naver.com/blog/article/ACTUAL_LOG_NO/cv, reached via the actual ranking row. Confirm the matching withsuzz original post URL and title. Do not substitute another profile, infer ownership from a title, or copy cookies.

Read only. Never write posts or change settings. The first observed detailed analysis showed 15 calendar days including today. A follow-up run verified previous-week navigation and a calendar selector; the selected weekly table contains seven dates. Use those actual controls to obtain older daily values. Import only completed days ending yesterday. Exclude dates preceding the actual publication date. Missing values are omitted; an explicitly displayed 0 is a measured zero. Views are post daily view counts, never unique visitors, searches or clicks. A ranking is usable only when the date selector explicitly identifies one day and the value belongs to that specific post. Period totals, ranks, percentages and whole-blog values must never be converted to daily post values.

## Narrow Site transport

GET /api/naver-post-sync returns catalog, coverage and sync status; it never returns full workspace, drafts or files. Choose actual known post links, prioritizing older/least-recently-measured archived posts and relevant traffic topics. A run is bounded, not a broad crawler. Use one TinyFish browser session for the combined 09:00 workflow; wait_for_run until terminal and do not start duplicates after timeouts.

POST `{kind:"snapshot",snapshot:{blogId:"withsuzz",authenticated:true,grain:"day",observedAt:"actual ISO observation/receipt time",runUrl:"actual TinyFish run URL",sourceUrl:"actual withsuzz admin statistics URL or matched post-specific cv URL",metricDefinition:"actual UI definition",posts:[{title:"actual title",url:"https://blog.naver.com/withsuzz/ACTUAL_LOG_NO",publishedDate:"YYYY-MM-DD or null",sourceUrl:"actual matched detailed-analysis URL if read",rows:[{date:"YYYY-MM-DD",views:187}]}],limitations:[]}}`.

Canonicalize observed HTTP Naver post links to their equivalent HTTPS URL. Convert displayed dotted publication dates mechanically; never infer a date. Date-only collection timestamps may be recorded as the actual tool receipt time, without claiming a precise browser observation time. Only visits/views/searchClicks integers are accepted, each with their actual meaning. Up to 30 posts, 1500 observed daily rows and 250,000 request characters per call. The entire snapshot is validated before mutation. Unknown, today/future, duplicate day, conflicting ownership and pre-publication observations are rejected.

The server stores source `naver-post-daily`, measuredFields, runUrl, observedAt and actual sourceUrl per daily record. Re-imports of the same run are idempotent; later runs update matching dates without adding duplicates. Older observations cannot overwrite a newer snapshot. A missing field does not erase a measured field.

Existing exact-link content items keep their draft/status/date and XP. Previously unseen posts become locked archived records, with empty body and an explicit note that the original experience/body has not been read. A known publication day is stored with day precision. An unknown publication date stays unknown; only the earliest actual positive daily measurement establishes the minimum age (a pre-publication graph can display zeros, so zeros alone do not prove the post existed) for comparison. A title alone never links two items. Ambiguous duplicate links remain unlinked with a warning.

POST `{kind:"failure",message:"short reason without secrets"}` changes only post-sync status and preserves good data. Whole-blog sync remains independent. POST `{kind:"schedule",automationId:"actual saved automation ID"}` only after updating and verifying the existing 09:00 task; it records registration, not evidence of a future run. Do not create a duplicate task or change the schedule.

GET again and verify exact original links, measured-day counts and latest date/values. GET /api/refresh-agent recalculates decay recommendations from actual same-source data. The two 14-day comparison windows still each need at least seven observed days; adding one batch does not fabricate a decline candidate. GET/POST /api/manager-review integrates the stored evidence into reports.

## Scheduled scope

Preserve existing UV/search-keyword collection, saved profile, source fallback and 09:00 Asia/Seoul cadence. Extend the existing task with bounded post-level collection, rotating archived posts when full coverage cannot fit one run. Store available complete whole-blog statistics and post-level observations independently. Missing post data must not erase valid whole-blog data. Report access failure or inadequate coverage honestly; never claim every post/all six months was retrieved.

Past-date navigation was verified in run 5eb6d931-08c0-4d03-8905-481780be0828; only actual returned dates/values are evidence. Per-post search keywords still require a verified displayed scope and period before import; a global referrer tab is not evidence of post-specific keywords. CPA/affiliate clicks and conversions are independent data sources and are not inferred from Naver views.
