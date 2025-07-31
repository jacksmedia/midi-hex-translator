function translateEventsToSnesHex(events, schema) {
  return events.map(evt => {
    const name = evt.name || "REST";
    const duration = snapDuration(evt.duration); // normalize to known key
    const hex = schema[name]?.[duration] || schema["default"];

    return hex;
  });
}

function snapDuration(duration) {
  const knownDurations = [
    4.0, 3.0, 2.0, 1.5, 1.33, 1.0,
    0.75, 0.666, 0.5, 0.333, 0.25,
    0.166, 0.125, 0.083, 0.0625, 0.0416
  ];

  return knownDurations.find(d => Math.abs(d - duration) < 0.05)?.toString() || "unknown";
}

module.exports = { translateEventsToSnesHex };
