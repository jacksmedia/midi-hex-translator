function snapDuration(duration) {
  const known = [
    1.0, 0.75, 0.5, 0.375, 0.33, 0.25,
    0.1875, 0.1667, 0.125, 0.083, 0.0625,
    0.0417, 0.0313, 0.0208, 0.0156
  ];
  const snapped = known.find(d => Math.abs(d - duration) < 0.01);
  return snapped?.toString() || null;
}

function translateEventsToFlatHex(events, schema) {
  return events.map(evt => {
    const name = evt.name || "REST";
    const duration = snapDuration(evt.duration);
    const key = `${name}:${duration}`;
    return schema[key] || "??"; // placeholder if not found
  });
}

module.exports = { translateEventsToFlatHex };
