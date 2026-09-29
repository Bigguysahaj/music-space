// Forward the whole app, including assets and streaming audio, to its Worker.
// Keep the original URL, method, headers and body; authentication stays there.
export default {
  fetch(request, env) {
    return env.APP.fetch(request);
  },
};
