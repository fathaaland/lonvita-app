FROM node:22-alpine

WORKDIR /home/node/app

RUN npm install -g pnpm@10 && chown node:node /home/node/app

# Not root: a hole in a processor (an import parsing someone's web page) gets the app's files at most.
USER node

COPY --chown=node:node package.json pnpm-lock.yaml ./
# Dev dependencies included — the worker runs from source through tsx. NODE_ENV is set only below,
# or pnpm would leave them out.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY --chown=node:node . .

ENV NODE_ENV=production \
    LOG_SERVICE=worker \
    PAYLOAD_MIGRATING=true

# node itself as PID 1, not pnpm → sh → tsx: SIGTERM on a deploy reaches the worker's own handler
# (runtime/shutdown), which lets running jobs finish instead of having them killed mid-send.
CMD ["node", "--import", "tsx", "worker/src/run.ts"]
