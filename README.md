# Gab Aggregator

Aggregate from gab, to telegram, it has a semi-persistent db used cache seen material, then if the new material is not present in the cach it is sent to a telegram channel. Note that it doesn't work for Gab private accounts. The script is suited to use and shuffle proxies to evase getting ip restricted.

It can be builded and runned as a docker image.

## Usage

Install any required package:
```sh
npm i
```

To run in development environment remember to add `.env` variables:

- `TG_BOT_KEY` is the telegram bot private key
- `MAX_GAB_POSTS_STORED` is the max number of posts the cache will store at any given point in time
- `GAB_ACCOUNTS_SPACED` are all the gab account the aggregator will fetch
- `PORT` is the port the aggregator will listen to
- 'NODE_ENV' set to "development" if runned in development environment, and "production" when started with a production environment (docker)

See `.env.example` for syntax examples.

Then use any javascript runtime (node):
```sh
node index.mjs
```

To buil the docker image:
```sh
docker build .
```

Remember to run the script announcing env variables `-e VARIABLE_NAME=VALUE` for `TG_BOT_KEY`, `MAX_GAB_POSTS_STORED`, `GAB_ACCOUNTS_SPACED` and `PORT`.
