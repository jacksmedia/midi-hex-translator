function translateEventsToHex(events, schema) {
  return events.map(evt => {
    const hex = schema[evt.name] || schema["default"];
    return hex;
  });
}

module.exports = { translateEventsToHex };
