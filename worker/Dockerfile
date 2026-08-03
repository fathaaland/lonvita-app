FROM node:22-alpine

WORKDIR /home/node/app

RUN npm install -g pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

CMD ["pnpm", "--dir", "worker", "run", "start"]
