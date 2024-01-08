FROM ghcr.io/puppeteer/puppeteer:21.1.1

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

ENV PORT=${PORT}

EXPOSE ${PORT}

USER root
CMD [ "node", "index.mjs" ]