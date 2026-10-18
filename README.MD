# forecast.by.vincent.mahn.ke

Hosts the container serving [forecast.by.vincent.mahn.ke](https://forecast.by.vincent.mahn.ke).

`GET /forecast?x=<longitude>&y=<latitude>&zoom=<2..100>&theme=<light|dark>` returns an animated GIF.
All parameters are optional. `theme` defaults to `light`. With `theme=dark`, the WetterOnline map and
rain imagery are colour-inverted, while city labels and the time box stay unchanged.

Forecast GIFs are cached per location and zoom until the next five-minute clock
boundary. During the following 60 seconds, the previous GIF may be served while
a refresh runs. At :01, :06, :11, etc. the previous interval's GIF is no longer
eligible: requests wait for regeneration, and failures return HTTP 502 instead
of an outdated map. A render that finishes after its own cutoff is regenerated.
Expiry is based on when generation started, not the GIF's first future frame.
HTTP responses require revalidation after the fresh interval; clients are not
given an additional stale-while-revalidate window.

Run cache regression tests with `cd app && npm test`.