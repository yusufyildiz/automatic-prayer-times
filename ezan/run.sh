#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
# with-contenv: makes SUPERVISOR_TOKEN / PULSE_SERVER from the container
# environment available to the Node process under s6-overlay.

TZ="$(bashio::config 'timezone' 'Europe/Vienna')"
export TZ

bashio::log.info "Ezan add-on başlatılıyor (TZ=${TZ})"
exec node /app/src/index.js
