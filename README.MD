# forecast.by.vincent.mahn.ke

Hosts the container serving [forecast.by.vincent.mahn.ke](https://forecast.by.vincent.mahn.ke).

`GET /forecast?x=<longitude>&y=<latitude>&zoom=<2..100>&theme=<light|dark>&label=<0|1>&noFooter=<0|1>&alpha=<0|1>` returns the
animation as an AV1 MP4 (`video/mp4`, 10 fps, about 40–60 KB; roughly 1/20 of an equivalent GIF).
`X-Forecast-Frames` and `X-Forecast-Frame-Delay-Ms` describe the animation.
It has one frame per minute for the next 90 minutes. Rain between WetterOnline's 5- and 15-minute forecast
images is morphed rather than cross-faded: each colour band is moved along optical flow and its outline is
interpolated, so cells drift, grow, and shrink without fading.
All parameters are optional. `label` defaults to `0`, skipping the city-name overlay.
Use `label=1` to show place names such as Hamburg. The map, rain forecast, and time box
remain visible in either mode. `theme` defaults to `light`. With `theme=dark`, the WetterOnline map and
rain imagery are colour-inverted, while city labels and the time box stay unchanged.
`noFooter=1` omits the time box and progress bar so clients can draw their own. Frames then only change
where rain moves, which makes the video smaller (about 60% with little rain, 10% with a lot).
`alpha=1` omits the basemap, labels, and footer and returns only the rain imagery over black.
MP4 does not provide dependable alpha-channel playback across clients, so request the synchronized
white-on-black opacity video from `GET /alpha` with the same location, zoom, and theme parameters.
Use that video as the alpha channel for the rain-only `/forecast?...&alpha=1` video. White means opaque
rain, black means transparent; the mask is independent of `theme`. For `theme=dark`, only the rain
colors are inverted. Both videos have matching frame counts and timestamps and use AV1 in MP4.
Frame `i` of `n` shows `X-Forecast-Start + i/(n-1) * (X-Forecast-End - X-Forecast-Start)`;
`X-Forecast-No-Footer` reports which variant was served.
Map tiles inside WetterOnline's European radar area use the European rain layer; tiles entirely
outside it (for example the Caribbean) use the global rain layer at its own maximum zoom.

Forecasts are cached per location, zoom, theme, label, and footer setting until the next five-minute clock
boundary. During the following 60 seconds, the previous video may be served while
a refresh runs. At :01, :06, :11, etc. the previous interval's video is no longer
eligible: requests wait for regeneration, and failures return HTTP 502 instead
of an outdated map. A render that finishes after its own cutoff is regenerated.
Expiry is based on when generation started, not the video's first future frame.
HTTP responses require revalidation after the fresh interval; clients are not
given an additional stale-while-revalidate window.

Run forecast and cache regression tests with `cd app && npm test`.