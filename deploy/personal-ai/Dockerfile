ARG BASE_IMAGE=ghcr.io/ayaka-notes/overleaf-pro@sha256:5f84c7f2d0230dd558130ca2901f603d4e0bfe021054879efea1b7fece2f4f1c
FROM ${BASE_IMAGE}

# The build script supplies source, production PnP metadata and compiled assets.
# Existing TeX Live, system services and Pyodide packages stay in the base image.
ADD overlay.tar /overleaf/
# Match the upstream server-ce image's runtime overrides after copying sources.
RUN cp /overleaf/server-ce/config/production.json /overleaf/services/history-v1/config/production.json \
    && cp /overleaf/server-ce/config/custom-environment-variables.json /overleaf/services/history-v1/config/custom-environment-variables.json
LABEL org.opencontainers.image.source="https://github.com/cyhcyh/ayakaleaf-pro" \
      space.ayaka.extensions="personal-ai,selection-translation,review-tools"
RUN chmod +x /overleaf/deploy/runtime/entrypoint.sh
ENTRYPOINT ["/overleaf/deploy/runtime/entrypoint.sh"]
