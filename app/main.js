import http from 'http';
import sharp from 'sharp';

const PORT = Number(process.env.PORT || 3000);
const page = String.raw`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f5f7f8">
    <title>Hamburg Rain Radar</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
    <style>
        :root {
            color-scheme: light;
            font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
            color: #172a35;
            background: #f5f7f8;
            font-synthesis: none;
            text-rendering: optimizeLegibility;
        }

        * { box-sizing: border-box; }

        html, body { width: 100%; height: 100%; margin: 0; }

        body { min-width: 320px; overflow: hidden; }

        .topbar {
            position: absolute;
            z-index: 500;
            top: 16px;
            left: 16px;
            display: flex;
            align-items: center;
            gap: 14px;
            min-height: 54px;
            padding: 9px 15px;
            border: 1px solid rgba(27, 55, 68, .13);
            border-radius: 5px;
            background: rgba(255, 255, 255, .96);
            box-shadow: 0 3px 14px rgba(25, 48, 60, .12);
        }

        .mark {
            width: 30px;
            height: 30px;
            display: grid;
            place-items: center;
            border-radius: 4px;
            color: white;
            background: #087d9c;
            font-size: 13px;
            font-weight: 700;
        }

        .brand { font-size: 15px; font-weight: 700; line-height: 1.15; }
        .place { margin-top: 3px; color: #637782; font-size: 12px; }

        #map { position: absolute; inset: 0; background: #e8eff1; }

        .timeline {
            position: absolute;
            z-index: 500;
            left: 50%;
            bottom: 22px;
            display: grid;
            grid-template-columns: 1fr;
            align-items: center;
            gap: 8px;
            width: min(680px, calc(100% - 32px));
            padding: 10px 13px;
            transform: translateX(-50%);
            border: 1px solid rgba(27, 55, 68, .13);
            border-radius: 5px;
            background: rgba(255, 255, 255, .97);
            box-shadow: 0 3px 14px rgba(25, 48, 60, .15);
        }

        button { font: inherit; }

        .map-zoom { display: grid; }
        .map-zoom button {
            width: 30px;
            height: 30px;
            padding: 0;
            border: 0;
            color: #263c47;
            background: #fff;
            cursor: pointer;
            font-size: 20px;
            line-height: 1;
        }

        .map-zoom button + button { border-top: 1px solid #d5dfe2; }
        .map-zoom button:disabled { color: #a9b5ba; cursor: default; }
        .map-zoom button:focus-visible { position: relative; z-index: 1; outline: 3px solid #f0a900; }

        .mode-switch {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 3px;
            padding: 3px;
            border-radius: 4px;
            background: #eaf0f2;
        }

        .mode-tab {
            min-height: 30px;
            border: 0;
            border-radius: 3px;
            color: #526771;
            background: transparent;
            cursor: pointer;
            font-size: 12px;
        }

        .mode-tab[aria-pressed="true"] {
            color: #173544;
            background: #fff;
            box-shadow: 0 1px 3px rgba(25, 48, 60, .15);
            font-weight: 650;
        }

        .timeline-view {
            display: grid;
            grid-template-columns: 42px minmax(160px, 1fr) 76px;
            align-items: center;
            gap: 12px;
        }

        .timeline-view[hidden], .forecast-controls[hidden] { display: none; }

        .forecast-controls { display: grid; gap: 9px; }

        .forecast-heading, .forecast-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }

        .forecast-heading { color: #526771; font-size: 12px; }
        #forecast-target { color: #173544; font-size: 15px; font-weight: 700; }
        #forecast-time { color: #173544; font-size: 12px; font-weight: 650; }

        .forecast-transport {
            display: grid;
            grid-template-columns: 38px minmax(0, 1fr);
            align-items: center;
            gap: 12px;
        }

        #forecast-play {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 4px;
            color: white;
            background: #087d9c;
            cursor: pointer;
            font-size: 16px;
        }

        #forecast-play:hover { background: #066b85; }
        #forecast-play:focus-visible { outline: 3px solid #f0a900; outline-offset: 2px; }

        .forecast-range { display: grid; gap: 3px; }

        #forecast-step {
            width: 100%;
            margin: 0;
            accent-color: #087d9c;
            cursor: pointer;
        }

        #forecast-step:disabled { cursor: progress; }
        #forecast-source-time { color: #526771; font-size: 11px; }

        .forecast-footer {
            flex-wrap: wrap;
            color: #70828a;
            font-size: 10px;
        }

        .forecast-footer a { color: #176b82; }
        #forecast-status { color: #9b3c2e; font-size: 11px; }
        #forecast-status[hidden] { display: none; }

        #play {
            width: 38px;
            height: 38px;
            border: 0;
            border-radius: 4px;
            color: #fff;
            background: #087d9c;
            cursor: pointer;
            font-size: 16px;
        }

        #play:hover { background: #066b85; }
        #play:focus-visible, input:focus-visible { outline: 3px solid #f0a900; outline-offset: 2px; }

        .range-wrap { display: grid; gap: 3px; }

        #frames {
            width: 100%;
            margin: 0;
            accent-color: #087d9c;
            cursor: pointer;
        }

        .range-labels {
            display: flex;
            justify-content: space-between;
            color: #70828a;
            font-size: 10px;
        }

        #frame-time { color: #273c47; font-size: 12px; text-align: right; white-space: nowrap; }

        .legend {
            position: absolute;
            z-index: 500;
            right: 16px;
            bottom: 94px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border: 1px solid rgba(27, 55, 68, .12);
            border-radius: 4px;
            background: rgba(255, 255, 255, .95);
            box-shadow: 0 2px 9px rgba(25, 48, 60, .10);
            color: #526771;
            font-size: 10px;
        }

        .legend-colors {
            width: 94px;
            height: 8px;
            border-radius: 2px;
            background: linear-gradient(90deg, #c6f6ff, #47c9f2, #2687e8, #1648ba, #752cad);
        }

        #status {
            position: absolute;
            z-index: 500;
            top: 82px;
            left: 16px;
            max-width: min(340px, calc(100% - 32px));
            padding: 8px 11px;
            border-radius: 4px;
            color: #435a65;
            background: rgba(255, 255, 255, .93);
            box-shadow: 0 2px 9px rgba(25, 48, 60, .10);
            font-size: 12px;
        }

        #status[hidden] { display: none; }

        .leaflet-control-attribution { font-size: 10px !important; }

        .leaflet-marker-icon.forecast-city-label {
            border: 0;
            background: transparent;
        }

        .forecast-city-name {
            display: block;
            color: #172229;
            font-size: 12px;
            font-weight: 500;
            text-align: center;
            white-space: nowrap;
            text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff;
        }

        @media (max-width: 520px) {
            .topbar { top: 10px; left: 10px; min-height: 48px; padding: 7px 10px; }
            #status { top: 68px; left: 10px; }
            .timeline { bottom: 28px; gap: 7px; width: calc(100% - 20px); padding: 8px 9px; }
            .timeline-view { grid-template-columns: 38px minmax(80px, 1fr) 62px; gap: 8px; }
            #play { width: 36px; height: 36px; }
            .forecast-transport { grid-template-columns: 36px minmax(0, 1fr); gap: 8px; }
            #forecast-play { width: 36px; height: 36px; }
            .forecast-footer { font-size: 9px; }
            .legend { right: 10px; bottom: 82px; }
        }
    </style>
</head>
<body>
    <header class="topbar">
        <div class="mark" aria-hidden="true">RR</div>
        <div>
            <div class="brand">Rain radar</div>
            <div class="place">Hamburg, Germany</div>
        </div>
    </header>
    <div id="map" role="application" aria-label="Interactive rain radar map centered on Hamburg"></div>
    <div id="status" role="status">Loading radar…</div>
    <div class="legend" aria-label="Rain intensity">
        <span>Light</span><div class="legend-colors" aria-hidden="true"></div><span>Heavy</span>
    </div>
    <div class="timeline">
        <div class="mode-switch" role="group" aria-label="Weather view">
            <button id="radar-mode" class="mode-tab" type="button" aria-pressed="true">Radar history</button>
            <button id="forecast-mode" class="mode-tab" type="button" aria-pressed="false">Next 90 min</button>
        </div>
        <div id="radar-controls" class="timeline-view">
            <button id="play" type="button" aria-label="Play radar animation" title="Play radar animation">▶</button>
            <label class="range-wrap" for="frames">
                <input id="frames" type="range" min="0" max="0" value="0" disabled aria-label="Radar time frame">
                <span class="range-labels"><span>Older</span><span>Latest</span></span>
            </label>
            <time id="frame-time">--:--</time>
        </div>
        <div id="forecast-controls" class="forecast-controls" hidden>
            <div class="forecast-heading">
                <div><strong id="forecast-target">+5 min</strong> forecast map</div>
                <time id="forecast-time">--:--</time>
            </div>
            <div class="forecast-transport">
                <button id="forecast-play" type="button" aria-label="Play forecast animation" title="Play forecast animation">▶</button>
                <label class="forecast-range" for="forecast-step">
                    <input id="forecast-step" type="range" min="0" max="17" value="0" disabled aria-label="Choose a 5-minute forecast interval">
                    <span class="range-labels"><span>+5 min</span><span>+90 min</span></span>
                </label>
            </div>
            <div id="forecast-source-time">Loading map frame…</div>
            <div class="forecast-footer">
                <span id="forecast-cadence">Five-minute selections use available forecast map frames.</span>
                <a href="https://www.wetteronline.de/regenradar/hamburg" target="_blank" rel="noreferrer">WetterOnline RegenRadar</a>
            </div>
            <div id="forecast-status" role="status" hidden></div>
        </div>
    </div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        const status = document.getElementById('status');
        const slider = document.getElementById('frames');
        const playButton = document.getElementById('play');
        const frameTime = document.getElementById('frame-time');
        const radarModeButton = document.getElementById('radar-mode');
        const forecastModeButton = document.getElementById('forecast-mode');
        const radarControls = document.getElementById('radar-controls');
        const forecastControls = document.getElementById('forecast-controls');
        const forecastSlider = document.getElementById('forecast-step');
        const forecastPlayButton = document.getElementById('forecast-play');
        const forecastTarget = document.getElementById('forecast-target');
        const forecastTime = document.getElementById('forecast-time');
        const forecastSourceTime = document.getElementById('forecast-source-time');
        const forecastCadence = document.getElementById('forecast-cadence');
        const forecastStatus = document.getElementById('forecast-status');
        const map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 10 }).setView([53.55, 9.99], 9);

        const baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        const zoomButtons = {};
        const zoomControl = L.control({ position: 'topright' });
        zoomControl.onAdd = function () {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-zoom');
            zoomButtons.in = L.DomUtil.create('button', '', container);
            zoomButtons.in.type = 'button';
            zoomButtons.in.textContent = '+';
            zoomButtons.in.title = 'Zoom in';
            zoomButtons.in.setAttribute('aria-label', 'Zoom in');
            zoomButtons.out = L.DomUtil.create('button', '', container);
            zoomButtons.out.type = 'button';
            zoomButtons.out.textContent = '−';
            zoomButtons.out.title = 'Zoom out';
            zoomButtons.out.setAttribute('aria-label', 'Zoom out');
            zoomButtons.in.addEventListener('click', function () {
                map.setView(map.getCenter(), Math.min(map.getZoom() + 1, map.getMaxZoom()), { animate: false });
            });
            zoomButtons.out.addEventListener('click', function () {
                map.setView(map.getCenter(), Math.max(map.getZoom() - 1, map.getMinZoom()), { animate: false });
            });
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.disableScrollPropagation(container);
            return container;
        };
        zoomControl.addTo(map);

        function updateZoomControls() {
            zoomButtons.in.disabled = map.getZoom() >= map.getMaxZoom();
            zoomButtons.out.disabled = map.getZoom() <= map.getMinZoom();
        }

        map.on('zoomend', updateZoomControls);
        updateZoomControls();

        const hamburgIcon = L.divIcon({
            className: '',
            html: '<span style="display:block;width:13px;height:13px;border:3px solid #fff;border-radius:50%;background:#e6463b;box-shadow:0 1px 5px #47545a"></span>',
            iconSize: [13, 13],
            iconAnchor: [6, 6]
        });
        L.marker([53.55, 9.99], { icon: hamburgIcon, keyboard: false, interactive: false }).addTo(map);

        let radarLayer;
        let frames = [];
        let timer;
        let forecastSteps = [];
        let forecastMapMetadata;
        let forecastCompositeLayer;
        let forecastGeoLayer;
        let forecastCityLayer;
        let forecastCities;
        let activeForecastFrameId;
        let forecastTimer;
        let forecastModeActive = false;
        let forecastLoaded = false;
        let forecastLoading = false;

        function showFrame(index) {
            const frame = frames[index];
            if (!frame) return;
            slider.value = String(index);
            frameTime.dateTime = new Date(frame.time * 1000).toISOString();
            frameTime.textContent = new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
            }).format(new Date(frame.time * 1000));
            if (forecastModeActive) return;
            if (radarLayer) map.removeLayer(radarLayer);
            radarLayer = L.tileLayer(frame.url, {
                tileSize: 256,
                maxNativeZoom: 7,
                maxZoom: 12,
                opacity: 0.72,
                zIndex: 10,
                attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>'
            }).addTo(map);
        }

        function stopPlayback() {
            window.clearInterval(timer);
            timer = undefined;
            playButton.textContent = '▶';
            playButton.setAttribute('aria-label', 'Play radar animation');
            playButton.title = 'Play radar animation';
        }

        slider.addEventListener('input', function () {
            stopPlayback();
            showFrame(Number(slider.value));
        });

        playButton.addEventListener('click', function () {
            if (timer) {
                stopPlayback();
                return;
            }
            if (frames.length < 2) return;
            playButton.textContent = 'Ⅱ';
            playButton.setAttribute('aria-label', 'Pause radar animation');
            playButton.title = 'Pause radar animation';
            timer = window.setInterval(function () {
                const next = (Number(slider.value) + 1) % frames.length;
                showFrame(next);
            }, 850);
        });

        function formatForecastTime(timestamp) {
            return new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin'
            }).format(new Date(timestamp * 1000));
        }

        function parseForecastFrameTime(id) {
            const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(id);
            if (!match) return NaN;
            return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
                Number(match[4]), Number(match[5])) / 1000;
        }

        function buildForecastTileUrl(frame, coords) {
            const geo = forecastMapMetadata.geo;
            const zoom = Math.floor(coords.z);
            const baseX = coords.x * 2;
            const baseY = coords.y * 2;
            const geometryRoot = geo.staticLayer.path;
            const seamask = geo.staticLayer.lsmTopography;
            const topography = geo.staticLayer.rrTopography;
            const topographyExtension = topography.type[Math.max(0, Math.min(
                zoom - geo.minZoom, topography.type.length - 1))] || 'jpg';
            const baseTile = zoom + '/512/' + baseX + '_' + baseY;
            const seamaskPath = geometryRoot + seamask.path + 'ZL' + baseTile + '.png';
            const topographyPath = geometryRoot + topography.path + 'ZL' + baseTile + '.' + topographyExtension;
            const europeRain = frame.layers.europe && frame.layers.europe.rain;
            const globalRain = frame.layers.global && frame.layers.global.rain;
            const rainZoom = Math.min(zoom, (europeRain && europeRain.mnz) || 7);
            const rainScale = Math.pow(2, zoom - rainZoom);
            const rainX = Math.floor(coords.x / rainScale) * 2;
            const rainY = Math.floor(coords.y / rainScale) * 2;
            const rainOffsetX = coords.x - Math.floor(coords.x / rainScale) * rainScale;
            const rainOffsetY = coords.y - Math.floor(coords.y / rainScale) * rainScale;

            function rainPath(layer, kind) {
                if (!layer) return '';
                return layer.ptypPath + layer.path + '/' + layer.timePath.join('/') +
                    '/ZL' + rainZoom + '/522/' + kind + '/' + rainX + '_' + rainY + '.png';
            }

            const rainPaths = [rainPath(europeRain, 'sprite'), rainPath(globalRain, 'border')]
                .filter(Boolean).join(';');
            const tileSet = 'seamask|1;;0;0|' + seamaskPath +
                '$topo|1;;0;0|' + topographyPath +
                '$r|' + rainScale + ';;' + rainOffsetX + ';' + rainOffsetY + ';false|' + rainPaths;
            const url = new URL('https://tiles.wo-cloud.com/composite');
            url.searchParams.set('format', 'webp');
            url.searchParams.set('lg', 'rr');
            url.searchParams.set('tiles', btoa(tileSet));
            url.searchParams.set('time', frame.id);
            return url.toString();
        }

        function showForecastFrame(frame) {
            if (activeForecastFrameId === frame.id) return;
            if (forecastCompositeLayer) map.removeLayer(forecastCompositeLayer);
            if (radarLayer) map.removeLayer(radarLayer);
            if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer);

            forecastCompositeLayer = L.tileLayer('', {
                tileSize: 512,
                minZoom: geoMinimumZoom(),
                maxZoom: forecastMapMetadata.geo.maxZoom,
                noWrap: true,
                attribution: '<a href="https://www.wetteronline.de/regenradar/hamburg">WetterOnline RegenRadar</a>'
            });
            forecastCompositeLayer.getTileUrl = function (coords) {
                return buildForecastTileUrl(frame, coords);
            };
            forecastCompositeLayer.addTo(map);
            if (forecastGeoLayer) map.removeLayer(forecastGeoLayer);
            forecastGeoLayer = L.tileLayer('', {
                tileSize: 512,
                minZoom: geoMinimumZoom(),
                maxZoom: forecastMapMetadata.geo.maxZoom,
                noWrap: true,
                zIndex: 20
            });
            forecastGeoLayer.getTileUrl = function (coords) {
                const version = forecastMapMetadata.geo.staticLayer.rrGeooverlay.currentVersion;
                return 'https://radar.wo-cloud.com/geo-overlay/rr_geooverlay/' + version +
                    '/ZL' + coords.z + '/512/' + (coords.x * 2) + '_' + (coords.y * 2) + '.svg';
            };
            forecastGeoLayer.addTo(map);
            activeForecastFrameId = frame.id;
            updateForecastCityLabels();
        }

        function geoMinimumZoom() {
            return forecastMapMetadata ? forecastMapMetadata.geo.minZoom : 2;
        }

        function updateForecastCityLabels() {
            if (!forecastModeActive || !forecastCities) return;
            if (forecastCityLayer) {
                forecastCityLayer.clearLayers();
            } else {
                forecastCityLayer = L.layerGroup().addTo(map);
            }

            const bounds = map.getBounds();
            const visibleCities = Object.values(forecastCities).filter(function (city) {
                return city.name && Number(city.population) >= 25000 &&
                    bounds.contains([Number(city.lat), Number(city.lon)]);
            }).sort(function (left, right) {
                return Number(right.population) - Number(left.population);
            }).slice(0, 30);

            visibleCities.forEach(function (city) {
                const label = document.createElement('span');
                label.className = 'forecast-city-name';
                label.textContent = city.name;
                forecastCityLayer.addLayer(L.marker([Number(city.lat), Number(city.lon)], {
                    icon: L.divIcon({
                        className: 'forecast-city-label',
                        html: label.outerHTML,
                        iconSize: [120, 18],
                        iconAnchor: [60, 9]
                    }),
                    keyboard: false,
                    interactive: false
                }));
            });
        }

        map.on('moveend', updateForecastCityLabels);

        function selectForecastStep(index) {
            const step = forecastSteps[index];
            if (!step) return;
            forecastSlider.value = String(index);
            forecastTime.dateTime = new Date(step.time * 1000).toISOString();
            forecastTime.textContent = formatForecastTime(step.time);
            forecastTarget.textContent = '+' + ((index + 1) * 5) + ' min';
            forecastSourceTime.textContent = 'Map frame valid at ' + formatForecastTime(step.frame.time) +
                ' · ' + step.frame.resolution + '-minute provider interval';
            showForecastFrame(step.frame);
        }

        function loadForecast() {
            if (forecastLoaded || forecastLoading) return;
            forecastLoading = true;
            forecastSlider.disabled = true;
            forecastStatus.textContent = 'Loading WetterOnline forecast maps…';
            forecastStatus.hidden = false;

            Promise.all([
                fetch('https://tiles.wo-cloud.com/metadata?type=geo'),
                fetch('https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentHighRes&type=period'),
                fetch('https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentLowRes&type=period'),
                fetch('https://radar.wo-cloud.com/cities/v29/cities/de.json')
                    .then(function (response) { return response.ok ? response.json() : {}; })
                    .catch(function () { return {}; })
            ])
                .then(function (responses) {
                    const metadataResponses = responses.slice(0, 3);
                    const failed = metadataResponses.find(function (response) { return !response.ok; });
                    if (failed) throw new Error('Forecast metadata returned HTTP ' + failed.status);
                    return Promise.all(metadataResponses.map(function (response) { return response.json(); }))
                        .then(function (metadata) { return metadata.concat(responses[3]); });
                })
                .then(function (data) {
                    const geo = data[0];
                    const highResolution = data[1];
                    const lowResolution = data[2];
                    forecastCities = data[3];
                    const mapZoom = Math.floor(map.getZoom());
                    const highStep = geo.timeRangeConfig.periodCurrentHighRes.timeResolution[mapZoom] || 5;
                    const lowStep = geo.timeRangeConfig.periodCurrentLowRes.timeResolution[mapZoom] || 15;
                    const now = Number(highResolution.timestamp);
                    const horizon = now + 90 * 60;
                    const nativeFrames = new Map();

                    [
                        { period: highResolution, resolution: highStep },
                        { period: lowResolution, resolution: lowStep }
                    ].forEach(function (source) {
                        source.period.timesteps.forEach(function (frame) {
                            const time = parseForecastFrameTime(frame.id);
                            const available = frame.available;
                            if (!Number.isFinite(time) || time <= now || time > horizon) return;
                            if (Array.isArray(available) && available.indexOf(source.resolution) === -1) return;
                            if (!nativeFrames.has(frame.id) || source.resolution < nativeFrames.get(frame.id).resolution) {
                                nativeFrames.set(frame.id, {
                                    id: frame.id,
                                    time: time,
                                    resolution: source.resolution,
                                    layers: frame.layers
                                });
                            }
                        });
                    });

                    forecastMapMetadata = { geo: geo };
                    const availableFrames = Array.from(nativeFrames.values()).sort(function (left, right) {
                        return left.time - right.time;
                    });
                    if (!availableFrames.length || availableFrames[availableFrames.length - 1].time < horizon - lowStep * 60) {
                        throw new Error('The map service does not cover the full next 90 minutes');
                    }

                    forecastSteps = Array.from({ length: 18 }, function (_, index) {
                        const time = now + (index + 1) * 5 * 60;
                        let frame = availableFrames[0];
                        availableFrames.forEach(function (candidate) {
                            if (candidate.time <= time) frame = candidate;
                        });
                        return { time: time, frame: frame };
                    });

                    const intervals = Array.from(new Set(availableFrames.map(function (frame) {
                        return frame.resolution;
                    }))).sort(function (left, right) { return left - right; });
                    forecastCadence.textContent = 'Five-minute selections; provider map frames update every ' +
                        intervals.join(' or ') + ' minutes.';
                    forecastSlider.disabled = false;
                    selectForecastStep(0);
                    forecastLoaded = true;
                    forecastStatus.hidden = true;
                })
                .catch(function (error) {
                    forecastSlider.disabled = true;
                    forecastStatus.textContent = 'Forecast maps unavailable. ' + error.message;
                    forecastStatus.hidden = false;
                })
                .finally(function () {
                    forecastLoading = false;
                });
        }

        function setTimelineMode(forecast) {
            forecastModeActive = forecast;
            radarModeButton.setAttribute('aria-pressed', String(!forecast));
            forecastModeButton.setAttribute('aria-pressed', String(forecast));
            radarControls.hidden = forecast;
            forecastControls.hidden = !forecast;
            if (forecast) {
                if (radarLayer) map.removeLayer(radarLayer);
                if (map.hasLayer(baseLayer)) map.removeLayer(baseLayer);
                if (forecastLoaded) selectForecastStep(Number(forecastSlider.value));
                else loadForecast();
            } else {
                stopForecastPlayback();
                if (forecastCompositeLayer) map.removeLayer(forecastCompositeLayer);
                if (forecastGeoLayer) map.removeLayer(forecastGeoLayer);
                if (forecastCityLayer) map.removeLayer(forecastCityLayer);
                forecastCompositeLayer = undefined;
                forecastGeoLayer = undefined;
                forecastCityLayer = undefined;
                activeForecastFrameId = undefined;
                if (!map.hasLayer(baseLayer)) baseLayer.addTo(map);
                showFrame(Number(slider.value));
            }
        }

        function stopForecastPlayback() {
            window.clearInterval(forecastTimer);
            forecastTimer = undefined;
            forecastPlayButton.textContent = '▶';
            forecastPlayButton.setAttribute('aria-label', 'Play forecast animation');
            forecastPlayButton.title = 'Play forecast animation';
        }

        radarModeButton.addEventListener('click', function () { setTimelineMode(false); });
        forecastModeButton.addEventListener('click', function () { setTimelineMode(true); });
        forecastSlider.addEventListener('input', function () {
            selectForecastStep(Number(forecastSlider.value));
        });
        forecastPlayButton.addEventListener('click', function () {
            if (forecastTimer) {
                stopForecastPlayback();
                return;
            }
            if (!forecastSteps.length) return;
            forecastPlayButton.textContent = 'Ⅱ';
            forecastPlayButton.setAttribute('aria-label', 'Pause forecast animation');
            forecastPlayButton.title = 'Pause forecast animation';
            forecastTimer = window.setInterval(function () {
                const next = (Number(forecastSlider.value) + 1) % forecastSteps.length;
                selectForecastStep(next);
            }, 850);
        });

        fetch('https://api.rainviewer.com/public/weather-maps.json')
            .then(function (response) {
                if (!response.ok) throw new Error('Radar service returned HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                const available = (data.radar && data.radar.past) || [];
                if (!available.length) throw new Error('No radar frames are currently available');
                frames = available.slice(-7).map(function (frame) {
                    return {
                        time: frame.time,
                        url: data.host + frame.path + '/256/{z}/{x}/{y}/2/1_1.png'
                    };
                });
                slider.max = String(frames.length - 1);
                slider.disabled = frames.length < 2;
                showFrame(frames.length - 1);
                status.hidden = true;
            })
            .catch(function (error) {
                status.textContent = 'Radar data could not be loaded. ' + error.message;
                status.hidden = false;
            });
    </script>
</body>
</html>`;

const FORECAST_STEP_SECONDS = 5 * 60;
const FORECAST_FRAME_DELAY_MS = 180;
const HAMBURG = { latitude: 53.55, longitude: 9.99 };

function parseForecastFrameTime(id) {
    const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})-/.exec(id);
    if (!match) return NaN;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
        Number(match[4]), Number(match[5])) / 1000;
}

function projectMercator(latitude, longitude, zoom) {
    const maxLatitude = 85.0511287798;
    const clampedLatitude = Math.max(-maxLatitude, Math.min(maxLatitude, latitude));
    const latitudeRadians = clampedLatitude * Math.PI / 180;
    const worldSize = 256 * Math.pow(2, zoom);
    const mercatorY = Math.log((1 + Math.sin(latitudeRadians)) /
        (1 - Math.sin(latitudeRadians)));
    return {
        x: (longitude + 180) / 360 * worldSize,
        y: (0.5 - mercatorY / (4 * Math.PI)) * worldSize
    };
}

function escapeXml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character];
    });
}

function buildCityOverlaySvg(cities, zoom, center) {
    const topLeft = { x: center.x - 256, y: center.y - 256 };
    const labels = Object.values(cities || {}).filter(function (city) {
        return city.name && Number(city.population) >= 25000;
    }).map(function (city) {
        const point = projectMercator(Number(city.lat), Number(city.lon), zoom);
        return {
            name: city.name,
            population: Number(city.population),
            x: point.x - topLeft.x,
            y: point.y - topLeft.y
        };
    }).filter(function (city) {
        return city.x >= 4 && city.x <= 508 && city.y >= 10 && city.y <= 502;
    }).sort(function (left, right) {
        return right.population - left.population;
    }).slice(0, 30);

    const text = labels.map(function (city) {
        return '<text x="' + city.x.toFixed(1) + '" y="' + city.y.toFixed(1) +
            '" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif"' +
            ' font-size="12" fill="#172229" stroke="#fff" stroke-width="3"' +
            ' stroke-linejoin="round" paint-order="stroke">' + escapeXml(city.name) + '</text>';
    }).join('');

    return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' + text + '</svg>');
}

function providerPath(...parts) {
    return parts.join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

function buildCompositeTileUrl(frame, geo, zoom, tileX, tileY) {
    const seamask = geo.staticLayer.lsmTopography;
    const topography = geo.staticLayer.rrTopography;
    const topographyIndex = Math.max(0, Math.min(zoom - geo.minZoom, topography.type.length - 1));
    const baseX = tileX * 2;
    const baseY = tileY * 2;
    const baseTile = 'ZL' + zoom + '/512/' + baseX + '_' + baseY;
    const seamaskPath = providerPath(geo.staticLayer.path, seamask.path, baseTile + '.png');
    const topographyPath = providerPath(geo.staticLayer.path, topography.path,
        baseTile + '.' + (topography.type[topographyIndex] || 'jpg'));
    const europeRain = frame.layers.europe && frame.layers.europe.rain;
    const globalRain = frame.layers.global && frame.layers.global.rain;
    const rainZoom = Math.min(zoom, (europeRain && europeRain.mnz) || 7);
    const rainScale = Math.pow(2, zoom - rainZoom);
    const rainBaseX = Math.floor(tileX / rainScale) * 2;
    const rainBaseY = Math.floor(tileY / rainScale) * 2;
    const rainOffsetX = tileX - Math.floor(tileX / rainScale) * rainScale;
    const rainOffsetY = tileY - Math.floor(tileY / rainScale) * rainScale;

    function rainPath(layer, kind) {
        if (!layer) return '';
        return providerPath(layer.ptypPath, layer.path, layer.timePath.join('/'),
            'ZL' + rainZoom + '/522/' + kind + '/' + rainBaseX + '_' + rainBaseY + '.png');
    }

    const rainPaths = [rainPath(europeRain, 'sprite'), rainPath(globalRain, 'border')]
        .filter(Boolean).join(';');
    const tileSet = 'seamask|1;;0;0|' + seamaskPath +
        '$topo|1;;0;0|' + topographyPath +
        '$r|' + rainScale + ';;' + rainOffsetX + ';' + rainOffsetY + ';false|' + rainPaths;
    const url = new URL('https://tiles.wo-cloud.com/composite');
    url.searchParams.set('format', 'webp');
    url.searchParams.set('lg', 'rr');
    url.searchParams.set('tiles', Buffer.from(tileSet).toString('base64'));
    url.searchParams.set('time', frame.id);
    return url;
}

function buildGeoOverlayUrl(geo, zoom, tileX, tileY) {
    const version = geo.staticLayer.rrGeooverlay.currentVersion;
    const tilePath = 'ZL' + zoom + '/512/' + (tileX * 2) + '_' + (tileY * 2) + '.svg';
    return 'https://radar.wo-cloud.com/geo-overlay/rr_geooverlay/' + version + '/' + tilePath;
}

async function fetchProviderBuffer(url, allowMissing) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error('WetterOnline returned HTTP ' + response.status);
    return Buffer.from(await response.arrayBuffer());
}

async function mapWithConcurrency(items, concurrency, task) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, async function () {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await task(items[index], index);
        }
    }));
    return results;
}

async function renderHamburgFrame(frame, geo, cityOverlay, zoom, center, geoTileCache) {
    const firstTileX = Math.floor((center.x - 256) / 512);
    const firstTileY = Math.floor((center.y - 256) / 512);
    const cropLeft = Math.round(center.x - firstTileX * 512 - 256);
    const cropTop = Math.round(center.y - firstTileY * 512 - 256);
    const positions = [];

    for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 2; column += 1) {
            positions.push({
                x: firstTileX + column,
                y: firstTileY + row,
                left: column * 512,
                top: row * 512
            });
        }
    }

    const blankTile = await sharp({
        create: { width: 512, height: 512, channels: 4, background: '#fff' }
    }).png().toBuffer();
    const fetchedTiles = await Promise.all(positions.map(async function (position) {
        const geoKey = position.x + ':' + position.y;
        if (!geoTileCache.has(geoKey)) {
            geoTileCache.set(geoKey, fetchProviderBuffer(
                buildGeoOverlayUrl(geo, zoom, position.x, position.y), true
            ));
        }

        const [mapTile, geoTile] = await Promise.all([
            fetchProviderBuffer(buildCompositeTileUrl(frame, geo, zoom, position.x, position.y), true),
            geoTileCache.get(geoKey)
        ]);
        return { position: position, mapTile: mapTile, geoTile: geoTile };
    }));

    const mapLayers = [];
    const geoLayers = [];
    for (const tile of fetchedTiles) {
        mapLayers.push({
            input: tile.mapTile || blankTile,
            left: tile.position.left,
            top: tile.position.top
        });
        if (tile.geoTile) {
            geoLayers.push({
                input: await sharp(tile.geoTile).resize(512, 512, { fit: 'fill' }).png().toBuffer(),
                left: tile.position.left,
                top: tile.position.top
            });
        }
    }

    const mosaic = await sharp({
        create: { width: 1024, height: 1024, channels: 4, background: '#fff' }
    }).composite(mapLayers.concat(geoLayers)).png().toBuffer();

    const cropped = await sharp(mosaic)
        .extract({ left: cropLeft, top: cropTop, width: 512, height: 512 })
        .png()
        .toBuffer();
    return sharp(cropped).composite([{ input: cityOverlay }]).png().toBuffer();
}

async function generateForecastGif() {
    const metadataUrls = [
        'https://tiles.wo-cloud.com/metadata?type=geo',
        'https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentHighRes&type=period',
        'https://tiles.wo-cloud.com/metadata?lg=wr&period=periodCurrentLowRes&type=period',
        'https://radar.wo-cloud.com/cities/v29/cities/de.json'
    ];
    const metadataResponses = await Promise.all(metadataUrls.map(function (url) {
        return fetch(url, { signal: AbortSignal.timeout(20000) });
    }));
    const failedResponse = metadataResponses.slice(0, 3).find(function (response) { return !response.ok; });
    if (failedResponse) throw new Error('Forecast metadata returned HTTP ' + failedResponse.status);
    const [geo, highResolution, lowResolution, cities] = await Promise.all(metadataResponses.map(function (response, index) {
        if (index === 3 && !response.ok) return {};
        return response.json();
    }));
    const zoom = Number(geo.maxZoom);
    const highStep = Number(geo.timeRangeConfig.periodCurrentHighRes.timeResolution[zoom] || 5);
    const lowStep = Number(geo.timeRangeConfig.periodCurrentLowRes.timeResolution[zoom] || 15);
    const now = Date.now() / 1000;
    const candidates = new Map();

    [
        { period: highResolution, resolution: highStep },
        { period: lowResolution, resolution: lowStep }
    ].forEach(function (source) {
        source.period.timesteps.forEach(function (frame) {
            const time = parseForecastFrameTime(frame.id);
            if (!Number.isFinite(time)) return;
            if (Array.isArray(frame.available) && frame.available.indexOf(source.resolution) === -1) return;
            const existing = candidates.get(frame.id);
            if (!existing || source.resolution < existing.resolution) {
                candidates.set(frame.id, {
                    id: frame.id,
                    time: time,
                    resolution: source.resolution,
                    layers: frame.layers
                });
            }
        });
    });

    const availableFrames = Array.from(candidates.values()).sort(function (left, right) {
        return left.time - right.time;
    });
    const futureFrames = availableFrames.filter(function (frame) { return frame.time > now; });
    if (!futureFrames.length) throw new Error('WetterOnline has no future forecast frames');

    const forecastEnd = futureFrames[futureFrames.length - 1].time;
    const steps = [];
    for (let time = now; time <= forecastEnd; time += FORECAST_STEP_SECONDS) {
        let frame = availableFrames[0];
        availableFrames.forEach(function (candidate) {
            if (candidate.time <= time) frame = candidate;
        });
        steps.push({ time: time, frame: frame });
    }
    if (!steps.length) throw new Error('WetterOnline forecast produced no animation frames');

    const uniqueFrames = Array.from(new Map(steps.map(function (step) {
        return [step.frame.id, step.frame];
    })).values());
    const center = projectMercator(HAMBURG.latitude, HAMBURG.longitude, zoom);
    const cityOverlay = buildCityOverlaySvg(cities, zoom, center);
    const geoTileCache = new Map();
    const rendered = await mapWithConcurrency(uniqueFrames, 3, async function (frame) {
        return {
            id: frame.id,
            image: await renderHamburgFrame(frame, geo, cityOverlay, zoom, center, geoTileCache)
        };
    });
    const imageById = new Map(rendered.map(function (frame) { return [frame.id, frame.image]; }));
    const images = steps.map(function (step) { return imageById.get(step.frame.id); });
    const gif = await sharp(images, {
        join: { animated: true, across: 1, background: '#fff' }
    }).gif({
        loop: 0,
        delay: images.map(function () { return FORECAST_FRAME_DELAY_MS; }),
        keepDuplicateFrames: true,
        effort: 5
    }).toBuffer();

    return {
        data: gif,
        zoom: zoom,
        start: steps[0].time,
        end: steps[steps.length - 1].time,
        frames: steps.length
    };
}

let forecastGeneration;

const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
        res.writeHead(200);
        res.end('OK');
        return;
    }

    const requestUrl = new URL(req.url, 'http://localhost');
    if (requestUrl.pathname === '/forecast') {
        if (req.method !== 'GET') {
            res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET' });
            res.end('Method not allowed');
            return;
        }

        try {
            if (!forecastGeneration) forecastGeneration = generateForecastGif();
            const generation = forecastGeneration;
            const result = await generation;
            res.writeHead(200, {
                'Content-Type': 'image/gif',
                'Content-Length': result.data.length,
                'Cache-Control': 'no-store',
                'X-Forecast-Zoom': String(result.zoom),
                'X-Forecast-Frames': String(result.frames),
                'X-Forecast-Start': new Date(result.start * 1000).toISOString(),
                'X-Forecast-End': new Date(result.end * 1000).toISOString(),
                'X-Forecast-Source': 'WetterOnline RegenRadar'
            });
            res.end(result.data);
        } catch (error) {
            console.error('Forecast GIF generation failed:', error);
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end('WetterOnline forecast GIF generation failed');
        } finally {
            forecastGeneration = undefined;
        }
        return;
    }

    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page);
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
