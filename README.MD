# forecast.by.vincent.mahn.ke

Hosts the container serving [forecast.by.vincent.mahn.ke](https://forecast.by.vincent.mahn.ke).

`GET /forecast?x=<longitude>&y=<latitude>&zoom=<2..100>&theme=<light|dark>&label=<0|1>` returns an animated GIF.
All parameters are optional. `label` defaults to `0`, skipping the city-name overlay.
Use `label=1` to show place names such as Hamburg. The map, rain forecast, and time box
remain visible in either mode. `theme` defaults to `light`. With `theme=dark`, the WetterOnline map and
rain imagery are colour-inverted, while city labels and the time box stay unchanged.

Forecast GIFs are cached per location, zoom, theme, and label setting until the next five-minute clock
boundary. During the following 60 seconds, the previous GIF may be served while
a refresh runs. At :01, :06, :11, etc. the previous interval's GIF is no longer
eligible: requests wait for regeneration, and failures return HTTP 502 instead
of an outdated map. A render that finishes after its own cutoff is regenerated.
Expiry is based on when generation started, not the GIF's first future frame.
HTTP responses require revalidation after the fresh interval; clients are not
given an additional stale-while-revalidate window.

Run forecast and cache regression tests with `cd app && npm test`.