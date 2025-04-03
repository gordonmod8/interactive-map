# Demo of a globe and UI

To view, clone the repo, in VSCode, right click index.html > [open with Live Server]

#vibecode produced with Gemini 2.5, thank you Google.

Notes:
```
HTML (index.html): Sets up the basic page structure, includes the CSS, creates the container and canvas elements, and loads the D3 library and your script.js.
CSS (style.css): Styles the page to center the map container. The container uses vmin for responsive sizing, aspect-ratio: 1/1 to stay square, and importantly clip-path: circle(...) to create the circular viewport. The canvas is set to fill this container.
JavaScript (script.js):
    Configuration: Constants define initial settings, colors, data URL, and animation behavior.
    State: Variables track the D3 projection, path generator, zoom behavior, map data, current and target animation states.
    Initialization (initializeMap): Sets up canvas size, D3 projection (Orthographic), path generator, zoom behavior, loads data, and starts the animation loop.
    Sizing (setupCanvasSize, handleResize): Makes the canvas resolution match its display size (important for crispness on high DPI screens) and updates the projection when the window size changes.
    Projection (setupProjection): Configures the d3.geoOrthographic projection, centering it on the US initially and setting the initial scale to show a hemisphere.
    Zoom Limits (calculateScaleLimits): Attempts to calculate the D3 k values corresponding to the min/max geographic diameter requirement. This mapping is complex for orthographic projections and might need fine-tuning for precise diameter control. It sets the scaleExtent for d3.zoom.
    Zoom Handling (zoomStarted, zoomed, zoomEnded): Uses d3.zoom to handle user input (pinch, scroll, drag). It differentiates between panning and rotation (using Ctrl key or touch count). It updates target scale and rotation values.
    Panning/Rotation (applyPan, zoomed rotation logic): The panning logic attempts manual calculation based on drag movement to update the target rotation. The rotation logic (Ctrl+Drag) is currently a placeholder (TODO) as robust angle calculation based on drag needs more complex tracking of the drag start/end points relative to the center. For now, it falls back to panning.
    Reset (handleDoubleClick): Resets the target scale and rotation to the initial state and uses d3.zoom().transform to trigger a smooth animated transition via D3's internal mechanisms.
    Animation (startAnimationLoop, animateFrame): Uses requestAnimationFrame and linear interpolation (d3.interpolate or simple lerp) to smoothly move the projection's current scale and rotation towards the target values set by user interactions or reset. This provides the jerk-limited feel.
    Rendering (render): Clears the canvas and redraws the map elements (sphere, graticule, land, center dot) based on the current projection state. It's called within the animation loop when changes occur.
    Data Loading (loadMapData): Asynchronously fetches the GeoJSON data using d3.json.
```
