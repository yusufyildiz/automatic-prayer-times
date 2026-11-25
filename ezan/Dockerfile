# Multi-arch Home Assistant base image (Alpine). build.yaml is deprecated;
# the base image is set here and can still be overridden with BUILD_FROM.
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.24
FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG BUILD_VERSION

# nodejs: app runtime, mpg123/paplay: "local" output via PulseAudio,
# tzdata: Europe/Vienna for TZ
RUN apk add --no-cache \
      nodejs \
      npm \
      mpg123 \
      pulseaudio-utils \
      tzdata

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && apk del --no-cache npm

COPY src ./src
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]

LABEL \
    io.hass.name="Ezan Vakitleri" \
    io.hass.description="Diyanet namaz vakitlerinde ezan" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.version="${BUILD_VERSION}" \
    org.opencontainers.image.source="https://github.com/yusufyildiz/automatic-prayer-times"
