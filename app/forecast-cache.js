import { createHash } from 'node:crypto';

const FORECAST_INTERVAL_MS = 5 * 60 * 1000;
const FORECAST_CACHE_GRACE_MS = 60 * 1000;
const FORECAST_CACHE_MAX_ENTRIES = 8;

export function createForecastCache(generateForecastVideo) {
    const forecastCache = new Map();
    const forecastGeneration = new Map();

    function startForecastGeneration(location, cacheKey) {
        let generation = forecastGeneration.get(cacheKey);
        if (!generation) {
            const generationStartedAt = Date.now();
            console.info('[forecast] generation started', {
                x: location.x,
                y: location.y,
                zoom: location.zoom === undefined ? 'provider-max' : location.zoom,
                theme: location.theme || 'light',
                label: location.label === 1 ? 1 : 0,
                noFooter: location.noFooter === 1 ? 1 : 0
            });
            generation = generateForecastVideo(location).then(function (result) {
                const nextBoundary = (Math.floor(generationStartedAt / FORECAST_INTERVAL_MS) + 1) *
                    FORECAST_INTERVAL_MS;
                const entry = {
                    ...result,
                    expiresAt: nextBoundary,
                    staleUntil: nextBoundary + FORECAST_CACHE_GRACE_MS,
                    etag: '"' + createHash('sha256').update(result.data).digest('hex') + '"'
                };
                if (Date.now() < entry.staleUntil) {
                    forecastCache.set(cacheKey, entry);
                    while (forecastCache.size > FORECAST_CACHE_MAX_ENTRIES) {
                        forecastCache.delete(forecastCache.keys().next().value);
                    }
                } else {
                    console.warn('[forecast] render expired before caching; regeneration required', {
                        x: result.x,
                        y: result.y,
                        cacheUntil: new Date(entry.staleUntil).toISOString()
                    });
                    return entry;
                }
                console.info('[forecast] cache refreshed', {
                    x: result.x,
                    y: result.y,
                    zoom: result.zoom,
                    frames: result.frames,
                    cacheUntil: new Date(entry.staleUntil).toISOString(),
                    renderSeconds: ((Date.now() - generationStartedAt) / 1000).toFixed(1)
                });
                return entry;
            }).finally(function () {
                forecastGeneration.delete(cacheKey);
            });
            forecastGeneration.set(cacheKey, generation);
        }
        return generation;
    }

    return async function getCachedForecastVideo(location) {
        const cacheKey = [location.x.toFixed(6), location.y.toFixed(6),
            location.zoom === undefined ? 'max' : String(location.zoom), location.theme || 'light',
            location.label === 1 ? '1' : '0',
            location.noFooter === 1 ? '1' : '0'].join(':');
        for (const [key, entry] of forecastCache) {
            if (Date.now() >= entry.staleUntil) forecastCache.delete(key);
        }
        while (true) {
            const cached = forecastCache.get(cacheKey);
            if (cached && Date.now() < cached.staleUntil) {
                forecastCache.delete(cacheKey);
                forecastCache.set(cacheKey, cached);
                const stale = Date.now() >= cached.expiresAt;
                if (stale) {
                    startForecastGeneration(location, cacheKey).catch(function (error) {
                        console.error('[forecast] background refresh failed:', error);
                    });
                }
                return { result: cached, stale: stale };
            }

            forecastCache.delete(cacheKey);
            const result = await startForecastGeneration(location, cacheKey);
            // A render can cross its own cutoff; never return it after that cutoff.
            if (Date.now() < result.staleUntil) {
                return { result: result, stale: Date.now() >= result.expiresAt };
            }
        }
    };
}

export function forecastResponseHeaders(result, stale) {
    const maxAge = Math.max(0, Math.floor((result.expiresAt - Date.now()) / 1000));
    return {
        'Content-Type': 'video/mp4',
        'Content-Length': result.data.length,
        'Cache-Control': 'public, max-age=' + maxAge + ', must-revalidate',
        'Expires': new Date(result.expiresAt).toUTCString(),
        'ETag': result.etag,
        'X-Forecast-Stale': String(stale),
        'X-Forecast-Zoom': String(result.zoom),
        'X-Forecast-Source-Zoom': String(result.sourceZoom),
        'X-Forecast-X': String(result.x),
        'X-Forecast-Y': String(result.y),
        'X-Forecast-Theme': result.theme || 'light',
        'X-Forecast-Label': result.label === 1 ? '1' : '0',
        'X-Forecast-No-Footer': result.noFooter === 1 ? '1' : '0',
        'X-Forecast-Frames': String(result.frames),
        'X-Forecast-Frame-Delay-Ms': String(result.frameDelayMs),
        'X-Forecast-Start': new Date(result.start * 1000).toISOString(),
        'X-Forecast-End': new Date(result.end * 1000).toISOString(),
        'X-Forecast-Cache-Until': new Date(result.staleUntil).toISOString(),
        'X-Forecast-Source': 'WetterOnline RegenRadar'
    };
}
