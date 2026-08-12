// Netlify function wrapper - baca dari api/telegram.js
const handler = require('../../api/telegram.js');

exports.handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : {};
  const req = { body };
  const res = {
    status(status) { this._status = status; return this; },
    json(data) { this._data = data; return this; }
  };
  await handler(req, res);
  return {
    statusCode: res._status || 200,
    body: JSON.stringify(res._data || {})
  };
};
