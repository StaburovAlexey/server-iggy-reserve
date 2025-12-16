function isOriginAllowed(origin, allowedCorsHosts, extractHostname) {
  if (!origin) return true;
  const hostname = extractHostname(origin);
  return allowedCorsHosts.has(hostname);
}

function buildCorsOptions({ isProd, allowedCorsHosts, extractHostname }) {
  if (!isProd) return undefined;
  return {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, allowedCorsHosts, extractHostname)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  };
}

module.exports = {
  isOriginAllowed,
  buildCorsOptions,
};
