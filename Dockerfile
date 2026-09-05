# The MCP server, runnable without Node on the host:
#   docker run --rm -i -v "$PWD:/work" -w /work ghcr.io/lazy-senior-dev/tenured
# Reviewing needs a headless agent or an API key in the environment; the review_brief tool needs
# neither, because the calling client's own model does the reading.
FROM node:22-alpine

# npm ships inside the base image and pulls in dependencies of its own, none of which this
# server ever runs: there is nothing to install at run time. Removing it keeps those CVEs out of
# the published image and out of the scan that gates it.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

WORKDIR /app
# No dependencies to install: package.json declares none, so there is nothing to resolve at build
# time and nothing to audit at run time.
COPY package.json persona.json ./
COPY bin ./bin
COPY hooks ./hooks
COPY mcp ./mcp
COPY rules ./rules
COPY skills ./skills
COPY benchmarks/lib ./benchmarks/lib
COPY LICENSE NOTICE README.md ./

RUN addgroup -S review && adduser -S review -G review && chown -R review:review /app
USER review

ENTRYPOINT ["node", "/app/bin/tenured.mjs"]
CMD ["mcp"]
