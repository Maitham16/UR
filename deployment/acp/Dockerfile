# Build context: the extracted, checksum-verified native Linux release directory.
# The base is pinned; apt installs current security updates at image-build time.
FROM ubuntu@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 ur && useradd --uid 10001 --gid 10001 --home-dir /state --no-create-home ur \
    && mkdir -p /workspace /state/config /state/remote \
    && chown -R 10001:10001 /workspace /state
COPY --chown=0:0 ur /opt/ur/ur
COPY --chown=0:0 resources /opt/ur/resources
RUN chmod -R go-w /opt/ur && chmod 755 /opt/ur/ur && /opt/ur/ur --version
ENV HOME=/state UR_CONFIG_DIR=/state/config UR_REMOTE_STATE_DIR=/state/remote \
    PATH=/opt/ur:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 10001:10001
WORKDIR /workspace
EXPOSE 8123
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:8123/healthz >/dev/null || exit 1
ENTRYPOINT ["/opt/ur/ur"]
CMD ["acp", "serve", "--host", "0.0.0.0", "--port", "8123"]
