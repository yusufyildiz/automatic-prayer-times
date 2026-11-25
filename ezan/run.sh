#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
# with-contenv: makes SUPERVISOR_TOKEN / PULSE_SERVER from the container
# environment available to the Node process under s6-overlay.
# Options (incl. timezone → TZ) are read by Node from /data/options.json.

bashio::log.info "Ezan add-on başlatılıyor"
exec node /app/src/index.js
