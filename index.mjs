import "dotenv/config";

import { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteer.use(StealthPlugin());
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
const puppeteerCachePath = "./cachePuppeteer";

import tunnel from "tunnel";
import * as cheerio from "cheerio";
import { CronJob } from "cron";
import { Mutex } from "async-mutex";
const mutex = new Mutex();
import express from "express";
const app = express();
import { Telegraf } from "telegraf";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

import fse from "fs-extra";
import fs from "fs";

const PORT = process.env.PORT;
const tgBotKey = process.env.TG_BOT_KEY;
const tgBot = new Telegraf(tgBotKey);
const maxGabPostsStored = Number(process.env.MAX_GAB_POSTS_STORED);
const gabAccounts = process.env.GAB_ACCOUNTS_SPACED.split(" ");
const mediaCache = "./mediaCache";

// Data types
class Post {
    // Add commented posts if case
    id;
    text;
    attachments;
    hasQuote;
    idQuote;
    isQuoted;

    /**
     * @param {string} id the post id
     * @param {string} text the post text
     * @param {Array[string]} attachments the post attachements (images, video)
     * @param {boolean} hasQuoted if the post has a quote of another post
     * @param {string} idQuote the post id of the quoted post
     * @param {boolean} isQuoted the post is a quote of another post
     */
    constructor(
        id = undefined,
        text = undefined,
        attachments = [],
        hasQuote = undefined,
        idQuote = undefined,
        isQuoted = undefined
    ) {
        this.id = id;
        this.text = text;
        this.attachments = attachments;
        this.hasQuote = hasQuote;
        this.idQuote = idQuote;
        this.isQuoted = isQuoted;
    }
}

// db Logic
class dbGab {
    dbPATH = "./db/gab/";

    /**
     * write will write to the db file
     * @param {string} account the name of the gab account
     * @param {*} data the json data to write
     * @returns
     */
    write(account = "", data) {
        // Wrong input returns false
        if (account == "") {
            return false;
        }

        // path to file
        let path = this.dbPATH + account + ".json";

        if (!this.ensureItExists(path)) {
            return null;
        }

        fse.writeJsonSync(path, data, {
            throws: false,
        });

        return true;
    }

    /**
     * read will read from the db file
     * @param {string} account the name of the gab account
     * @returns false on wrong input, 0 on empty file, the json object on succesfull read, null on unsuccesful read, and 1 on unsuccesfull creation.
     */
    read(account = "") {
        // Wrong input returns false
        if (account == "") {
            return false;
        }

        // path to file
        let path = this.dbPATH + account + ".json";

        // Return null if can't create
        if (!this.ensureItExists(path)) {
            console.log("Does not exist");
            return 1;
        }

        const stats = fs.statSync(path);
        const fileSize = stats.size;

        if (fileSize == 0) {
            return 0;
        }

        // Return object on read or null if can't red
        return fse.readJsonSync(path, {
            throws: false,
        });
    }

    /**
     * ensureItExists ensures that the file exists, if not it creates it
     * @param {string} account the name of the gab account
     * @returns
     */
    ensureItExists(path) {
        // Does not return anything
        fse.ensureFileSync(path);
        return true;
    }
}

/**
 * sleep for @param ms milliseconds
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * handlerFetchRequest handles a fetch request
 * @param {string} url for the request
 * @param {string} config config of the request
 * @param {string} proxy is the full proxy address in format: "protocol://ip:port/"
 * @returns the request response if successful, if not it prints the error and returns null
 */
async function handlerFetchRequest(url, config, proxy = null) {
    if (proxy != null) {
        let proxyHostPort = proxy.split(":");
        const configTunnel = tunnel.httpsOverHttps({
            proxy: {
                host: proxyHostPort[0],
                port: proxyHostPort[1],
            },
        });
        config.agent = configTunnel;
    }
    return await fetch(url, config)
        .then((res) => {
            return res;
        })
        .catch((err) => {
            console.log("Error Fetching for Proxies: ", err);
            return null;
        });
}

/**
 * setupBrowserInterface sets up a browser interface
 * @param {boolean} withProxy if you bild the browser with a proxy
 * @param {Array} proxyInfo array of address and port of the proxy you want to use
 */
// var browser = Map();
var browser;
var page;
// var page = Map();
async function setupBrowserInterface(
    account = "",
    withProxy = false,
    proxyInfo = undefined
) {
    if ((account = "")) {
        console.log("Account not provided to set up the puppeteer browser");
        return;
    }

    // var localBrowser = browser.get(account);
    // var localPage;

    if (browser) {
        await browser.close();
    }

    console.log("\nSetting up new driver...");
    if (withProxy) {
        if (!proxyInfo) {
            throw new Error("Trying to use a proxy that is not defined");
        }

        console.log("IP: " + proxyInfo.toString());

        puppeteer.use(
            pluginProxy({
                address: proxyInfo[0],
                port: proxyInfo[1],
            })
        );

        browser = await puppeteer.launch({
            headless: "new",
            args: [
                `--disk-cache-dir=${puppeteerCachePath}`,
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--single-process",
                "--no-zygote",
            ],
            executablePath:
                process.env.NODE_ENV == "production"
                    ? process.env.PUPPETEER_EXECUTABLE_PATH
                    : puppeteer.executablePath(),
        });
        page = await browser.newPage();

        console.log("Browser and page setup completed");
        return;
    }

    console.log("IP: Local");

    browser = await puppeteer.launch({
        headless: "new",
        args: [
            `--disk-cache-dir=${puppeteerCachePath}`,
            "--disable-setuid-sandbox",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--single-process",
            "--no-zygote",
        ],
        executablePath:
            process.env.NODE_ENV == "production"
                ? process.env.PUPPETEER_EXECUTABLE_PATH
                : puppeteer.executablePath(),
    });

    page = await browser.newPage();

    console.log("Browser and page setup completed");
}

/**
 * proxyToProxyInfo formats the proxy string into and array [ip, port]
 * @param {string} proxy proxy ip and port
 * @returns
 */
async function proxyToProxyInfo(proxy) {
    return proxy.split(":");
}

/**
 * getProxiesSpysOrg gets proxies from spys.org,
 * @param {string} protocol the protocol that proxyies need to have
 */
const proxies = [];
async function getProxiesSpysOrgMutx(protocol = "HTTPS") {
    switch (protocol) {
        case "HTTPS":
            // Go page and wait
            await page.goto("https://spys.one/en/https-ssl-proxy/");
            // Collect proxies
            const e1HTTPS = await page.$$eval("tr.spy1xx", (elements) => {
                let serializedElements = elements.map((e) => {
                    let eFiltered = {
                        ip: e.querySelector("font.spy14").innerText,
                        latency: Number(
                            e
                                .querySelector("td:nth-child(6) font.spy1")
                                .textContent.trim()
                        ),
                        uptime: e
                            .querySelector("td:nth-child(8) font.spy1 acronym")
                            .textContent.trim(),
                    };
                    return eFiltered;
                });
                return serializedElements;
            });
            const e2HTTPS = await page.$$eval("tr.spy1x", (elements) => {
                var oneRun = true;
                let serializedElements = elements.map((e) => {
                    if (oneRun) {
                        oneRun = false;
                        return;
                    }

                    let eFiltered = {
                        ip: e.querySelector("font.spy14").innerText,
                        latency: Number(
                            e
                                .querySelector("td:nth-child(6) font.spy1")
                                .textContent.trim()
                        ),
                        uptime: e
                            .querySelector("td:nth-child(8) font.spy1 acronym")
                            .textContent.trim(),
                    };
                    return eFiltered;
                });
                return serializedElements;
            });
            e2HTTPS.shift();
            // Add to Array list
            for (let i = 0; i < e1HTTPS.length; ++i) {
                proxies.push(e1HTTPS[i]);
            }
            for (let i = 0; i < e2HTTPS.length; ++i) {
                proxies.push(e2HTTPS[i]);
            }
            break;

        case "HTTP":
            // Go page and wait
            await page.goto("https://spys.one/en/https-ssl-proxy/");
            // Collect proxies
            const e1HTTP = await page.$$eval("tr.spy1xx", (elements) => {
                let serializedElements = elements.map((e) => {
                    let eFiltered = {
                        ip: e.querySelector("font.spy14").innerText,
                        latency: Number(
                            e
                                .querySelector("td:nth-child(6) font.spy1")
                                .textContent.trim()
                        ),
                        uptime: e
                            .querySelector("td:nth-child(8) font.spy1 acronym")
                            .textContent.trim(),
                    };
                    return eFiltered;
                });
                return serializedElements;
            });
            const e2HTTP = await page.$$eval("tr.spy1x", (elements) => {
                var oneRun = true;
                let serializedElements = elements.map((e) => {
                    if (oneRun) {
                        oneRun = false;
                        return;
                    }

                    let eFiltered = {
                        ip: e.querySelector("font.spy14").innerText,
                        latency: Number(
                            e
                                .querySelector("td:nth-child(6) font.spy1")
                                .textContent.trim()
                        ),
                        uptime: e
                            .querySelector("td:nth-child(8) font.spy1 acronym")
                            .textContent.trim(),
                    };
                    return eFiltered;
                });
                return serializedElements;
            });
            e2HTTP.shift();
            // Add to Array list
            for (let i = 0; i < e1HTTP.length; ++i) {
                proxies.push(e1HTTP[i]);
            }
            for (let i = 0; i < e2HTTPS.length; ++i) {
                proxies.push(e2HTTP[i]);
            }
            break;

        default:
            console.log("Protocol not supported. Failed to fetch for proxies");
            break;
    }
}

/**
 * proxyToProxyInfo formats the proxy string into and array [ip, port]
 * @param {string} proxy proxy ip and port
 * @returns
 */
async function sortProxiesByLatency() {
    for (let i = 0; i < proxies.length; ++i) {
        for (let j = 0; j < proxies.length - 1 - i; ++j) {
            if (proxies[j].latency > proxies[j + 1].latency) {
                let proxy = proxies[j];
                proxies[j] = proxies[j + 1];
                proxies[j + 1] = proxy;
            }
        }
    }
}

/**
 * handleGabAccountPosts gets current posts of any gab account
 * @param {string} gabAccount is the name of the account
 */
const gabURL = "https://gab.com/";
var $ = null;
async function handleGabAccountPostsMutx(gabAccount = null) {
    if (gabAccount == null) {
        console.log("No account has been setted");
        return;
    }

    var htmlContent = "";
    try {
        await page.goto(gabURL + gabAccount);
        await page.waitForTimeout(3000);
        htmlContent = await page.content();
    } catch (e) { }

    // Parse html page, get request: Z4Zp4, webview: KNUL0
    $ = cheerio.load(htmlContent);

    const posts = $(".Z4Zp4").toArray(); // maybe add as env var if it can change

    return posts;
}

/**
 * filterGabPinnedPosts filters out any pinned posts.
 * @param {Array} posts must be an array of posts, retrived from handleGabAccountPosts
 * @returns @param unpinnedPosts array of post that are not pinned
 */
async function filterGabPinnedPosts(posts = null) {
    if ($ == null) {
        console.log("Unable to continue, page not loaded");
        return;
    }

    if (posts == null) {
        console.log("No posts have been passed in");
        return;
    }

    // Filter unpinned posts
    const unpinnedPosts = posts.filter((e) => {
        const pinnedGab = $(e).find('[data-text="Pinned gab"]').length; // maybe add also this as env possible change

        if (pinnedGab != 0) {
            return false;
        }

        return true;
    });

    return unpinnedPosts;
}

/**
 * returnGabPostsFormattedToData takes an array of posts and formats them based on Post datatype
 * @param {Array} posts array of posts
 * @returns
 */
async function returnGabPostsFormattedToData(posts = null) {
    if ($ == null) {
        console.log("Unable to continue, page not loaded");
        return;
    }

    if (posts == null) {
        console.log("No posts have been passed in");
        return;
    }

    function quoteTweet(e) {
        let post = new Post("", "", [], true, "", false);

        // Fetching post id
        try {
            post.id = $(e).find("div:eq(3)").attr("data-id"); // maybe add also this as env possible change
        } catch (err) {
            console.log("Error when fetching for id: " + err);
            post.id = "";
        }

        const isReposted = /repost/i.test($(e).find("div:eq(4)").text());
        if (isReposted) {
            $(e).find("div:eq(4)").remove();
        }

        // Fetching if there is any text, if yes traverse
        try {
            let lang = Number($(e).find("[lang]").length);
            if (lang != 0) {
                // reliable the traverse?
                let text = $(e)
                    .find("div:eq(4)")
                    .next()
                    .children()
                    .children()
                    .text();

                text = text.replace(/\s+/g, " ");

                post.text = text;
            }
        } catch (err) {
            console.log("Error when fetching for text: " + err);
            post.text = "";
        }

        // Fetching if there are any images, if yes traverse them.
        try {
            // Check if there are images in the post because quote may have, thus creating unreliable code
            let totChildren = $(e).find("div:eq(3)").children().length;
            if (totChildren < 5) {
                throw Error("Warning: no images present in the post");
            }

            // data container can be in the quote tw but not on the main
            let attachements = $(e).find("[data-container]").toArray();
            for (let i = 0; i < attachements.length; ++i) {
                let thereIsVideo = $(attachements[i]).find("video").length;
                var link = "";
                if (thereIsVideo != 0) {
                    link = $(attachements[i]).find("video").attr("src");
                } else {
                    link = $(attachements[i]).find("img").attr("src");
                }

                if (Number($(attachements[i]).find("i").length) != 0) {
                    link = link
                        .replace(/\/small\//, "/playable/")
                        .replace(/\.[^.]+$/, ".mp4");
                }

                post.attachments.push(link);
            }
        } catch (err) {
            console.log("Error when fetching for attachements: " + err);
            post.attachments = [];
        }

        // Handling Quotes Recursively
        try {
            // Extract same element as quoted and its id, pass it to notQuoteTweet
            let totChildren = Number($(e).find("div:eq(3)").children().length);

            let findDivEq4 = $(e).find("div:eq(4)");
            for (let i = 0; i < totChildren - 1 - 1; ++i) {
                // (- 1 - 1): One to start index at zero, one to go until -2 index
                findDivEq4 = findDivEq4.next();
            }

            let quotedElement = findDivEq4.children().children();
            let postObjectQueote = notQuoteTweet(quotedElement);

            postObjectQueote.isQuoted = true;
            post.idQuote = postObjectQueote.id;

            quotedPosts.push(postObjectQueote);
        } catch (err) {
            console.log("Error when fetching for the quote: " + err);
            post.idQuote = "";
        }

        return post;
    }

    function notQuoteTweet(e) {
        let post = new Post("", "", [], false, "", false);

        // Fetching post id
        try {
            post.id = $(e).find("div:eq(3)").attr("data-id"); // maybe add also this as env possible change
        } catch (err) {
            console.log("Error when fetching for id: " + err);
            post.id = "";
        }

        const isReposted = /repost/i.test($(e).find("div:eq(4)").text());
        if (isReposted) {
            $(e).find("div:eq(4)").remove();
        }

        // Fetching if there is any text, if yes traverse
        try {
            let lang = Number($(e).find("[lang]").length);
            if (lang != 0) {
                // reliable the traverse?
                let text = $(e)
                    .find("div:eq(4)")
                    .next()
                    .children()
                    .children()
                    .text();

                text = text.replace(/\s+/g, " ");

                post.text = text;
            }
        } catch (err) {
            console.log("Error when fetching for text: " + err);
            post.text = "";
        }

        // Fetching if there are any images or videos, if yes traverse them.
        try {
            let attachements = $(e).find("[data-container]").toArray();
            for (let i = 0; i < attachements.length; ++i) {
                let thereIsVideo = $(attachements[i]).find("video").length;
                var link = "";
                if (thereIsVideo != 0) {
                    link = $(attachements[i]).find("video").attr("src");
                } else {
                    link = $(attachements[i]).find("img").attr("src");
                }

                if (Number($(attachements[i]).find("i").length) != 0) {
                    link = link
                        .replace(/\/small\//, "/playable/")
                        .replace(/\.[^.]+$/, ".mp4");
                }

                post.attachments.push(link);
            }
        } catch (err) {
            console.log("Error when fetching for attachements: " + err);
            post.attachments = [];
        }

        return post;
    }

    // Format posts to Post data type.
    var quotedPosts = [];
    const formattedPosts = posts.map((e) => {
        const idNumber = Number($(e).find("[data-id]").length);

        switch (idNumber) {
            case 0:
                return null;
            case 1:
                return notQuoteTweet(e);

            case 2:
                return quoteTweet(e);

            default:
                console.log("Three Ids, is it possible?, id: " + idNumber);
                console.log("" + $(e).html());
                break;
        }
    });

    formattedPosts.push(...quotedPosts);

    let noNullFormattedPosts = formattedPosts.filter((e) => e);

    return noNullFormattedPosts;
}

/**
 * returnNewPosts returns an array of newPosts' posts that are not present in the oldPosts
 * if there are posts that quote returnNewPosts will return them with their quoted post
 * @param {Array[Post]} newPosts
 * @param {Array[Post]} oldPosts
 * @returns
 */
async function returnNewlyPresentPosts(newPosts = null, oldPosts = null) {
    if (newPosts == null || oldPosts == null) {
        console.log("No posts have been passed in either new or old");
        return null;
    }

    if (oldPosts.length == 0) {
        return newPosts;
    }

    const newlyPresentPosts = [];

    for (let i = 0; i < newPosts.length; ++i) {
        var quote = null;
        var present = false;
        for (let j = 0; j < oldPosts.length; ++j) {
            if (newPosts[i].id == oldPosts[j].id) {
                present = true;
            }

            if (newPosts[i].hasQuote && newPosts[i].idQuote == oldPosts[j].id) {
                quote = oldPosts[j].id;
            }
        }

        if (!present) {
            newlyPresentPosts.push(newPosts[i]);

            if (quote != null) {
                newlyPresentPosts.push(quote);
            }
        }
    }

    return newlyPresentPosts;
}

/**
 * handleGabPostsWrite takes an array of posts, checks if they are already present
 * if they are they get discarded, if they aren't they'll get added from the top.
 * If the number of posts exceedes @param maxGabPostsStored they'll get deleted until the threshold is met
 * @param {Array[Post]} postsToWrite posts you want to write to the db
 */
async function handleGabPostsWrite(postsToWrite = null, account = "") {
    if (account == "") {
        console.log("No acccount has been passed in");
        return;
    }
    if (postsToWrite == null) {
        console.log("No posts have been passed in");
        return;
    }

    // Read db
    var postStored = await dbGAB.read(account);
    if (postStored == null) {
        console.log("Error during gab db read");
        return;
    }
    if (postStored == 0) {
        postStored = [];
    }

    // Check if passed array has old posts and filter them
    const actualPostsToWrite = await returnNewlyPresentPosts(
        postsToWrite,
        postStored
    );

    // Check if max number gets eceeded, yes: reduce posts of the array and related quotes
    var nPosts = postStored.length;
    if (actualPostsToWrite.length > maxGabPostsStored) {
        let exceess = maxGabPostsStored.length - maxGabPostsStored;
        for (let i = 0; i < exceess; ++i) {
            actualPostsToWrite.pop();
        }
    }

    if (nPosts + actualPostsToWrite.length > maxGabPostsStored) {
        let toEliminate =
            nPosts + actualPostsToWrite.length - maxGabPostsStored;
        for (let i = 0; i < toEliminate; ++i) {
            let eliminatedPost = postStored.pop();

            // If quoting or quoted post gets eliminate, delete also the related post
            if (eliminatedPost.hasQuote == true) {
                for (let i = 0; i < postStored.length; ++i) {
                    if (eliminatedPost.idQuote == postStored[i].id) {
                        postStored.splice(i, 1);
                    }
                }
            }
            if (eliminatedPost.isQuoted == true) {
                for (let i = 0; i < postStored.length; ++i) {
                    if (eliminatedPost.id == postStored[i].idQuote) {
                        postStored.splice(i, 1);
                    }
                }
            }
        }
    }

    // Fill new values
    console.log(
        `\nWriting ${actualPostsToWrite.length} new posts for ${account}`
    );
    for (let i = 0; i < actualPostsToWrite.length; ++i) {
        console.log(actualPostsToWrite[i]);
        postStored.unshift(actualPostsToWrite[i]);
    }

    // Write
    if (!dbGAB.write(account, postStored)) {
        console.log("Error during gab db write");
    }

    return true;
}

/**
 * gabAccountRoutine runs the routine for a gab account: Collect gabs, filter out new gabs
 * and store them in chronological order in the db
 * If new gabs are found the routine will trigger a telegram message to post the gab
 * @param {string} account the name of the account you want to run the routine for
 * @param {boolean} shuffleProxies if you want to use puppeteer with a proxy, shuffled for every routine
 * @returns true and the job if routine has been succesfull and false and null if routine has not been succesfull
 */
const stopRunning = new Map();
async function gabAccountRoutine(account = "", shuffleProxies = false) {
    console.log("\nExecuting Routine: " + account);
    stopRunning.set(account, false);

    if (account == "") {
        console.log("No account has been passed in");
        stopRunning.set(account, true);
        return;
    }

    if (!browser) {
        console.log("Puppeteer browser is necessary to run the routine");
        stopRunning.set(account, true);
        return;
    }

    if (shuffleProxies) {
        await mutex.runExclusive(async () => {
            await getProxiesSpysOrgMutx();
            await sortProxiesByLatency();
            await setupBrowserInterface(await proxyToProxyInfo(proxies[0]));
        });
    }

    var posts;
    await mutex.runExclusive(async () => {
        posts = await handleGabAccountPostsMutx(account);
    });
    posts = await filterGabPinnedPosts(posts);
    var formattedPosts = await returnGabPostsFormattedToData(posts);
    var currentStoredPosts = await dbGAB.read(account);

    if (currentStoredPosts != 0) {
        formattedPosts = await returnNewlyPresentPosts(
            formattedPosts,
            currentStoredPosts
        );
    }

    await mutex.runExclusive(async () => {
        await handleTelegramPost(formattedPosts);
    });

    if (!(await handleGabPostsWrite(formattedPosts, account))) {
        console.log("Error during handleGabPostsWrite");
        stopRunning.set(account, true);
        return;
    }

    console.log("Routine executed succesfully: " + account);
    return;
}

/**
 * startGabAccountRoutine starts gabAccountRoutine routine
 * @param {number} routimeTimeInMinutes time of the routine in minutes
 * @param {string} account the name of the account you want to run the routine for
 * @param {boolean} shuffleProxies if you want to use puppeteer with a proxy, shuffled for every routine
 * @returns
 */
async function startGabAccountRoutine(
    routimeIntervalMinutes = 1,
    routimeIntervalHours = 1,
    account = "",
    shuffleProxies = false
) {
    if (routimeIntervalHours == 0 || routimeIntervalHours > 24) {
        console.log(
            "Can't run the hourly routine this often: " + routimeIntervalHours
        );
        return false, null;
    }

    const job = new CronJob({
        cronTime: `${routimeIntervalMinutes} */${routimeIntervalHours} * * *`,
        onTick: async () => {
            currentlyRunningRoutines += 1;
            await gabAccountRoutine(account, shuffleProxies);
            currentlyRunningRoutines -= 1;

            if (stopRunning.get(account)) {
                job.stop();
            }
        },
    });

    return job;
}

/**
 * getFileExtension takes any url strings and returns its final file type
 * @param {string} url url string
 * @returns the file type, if there is no file tipe returns ""
 */
function getFileExtension(url) {
    // Get the part of the URL after the last '/'
    const parts = url.split("/");
    const lastPart = parts[parts.length - 1];
    // Split the last part by '.' to get the file extension
    const extensionParts = lastPart.split(".");
    if (extensionParts.length > 1) {
        return extensionParts[extensionParts.length - 1];
    } else {
        return ""; // No extension found
    }
}

/**
 * Tg bot
 */
var chatId = null;
/**
 * Bootstrap bot at "/start" command
 */
tgBot.start((ctx) => {
    chatId = ctx.chat.id;
    ctx.reply("Hello! I'm ready to deliver messages.");
    ctx.reply("This chat has been set as default for communications.");
});

tgBot.command("cleanmedia", (ctx) => {
    if (!chatId) {
        return;
    }

    ctx.reply("Cleaning Media Cache files");

    fs.readdir("./mediaCache", (err, files) => {
        if (err) {
            console.log("Error reading folder:", err);
            ctx.reply("Error reading folder:", err.toString());
            return;
        }

        for (let i = 0; i < files.length; ++i) {
            const filePath = "./mediaCache/" + files[i];

            fs.unlink(filePath, (err) => {
                if (!err) {
                    console.log(
                        `File ${filePath} has been deleted successfully.`
                    );
                }
            });
        }

        ctx.reply("Files have been cleaned.");
    });
});

tgBot.command("status", (ctx) => {
    if (!chatId) {
        return;
    }

    ctx.reply("Hello! I'm running correctly");

    fs.readdir("./mediaCache", (err, files) => {
        if (err) {
            console.log("Error reading folder:", err);
            ctx.reply("Error reading folder:", err.toString());
            return;
        }

        ctx.reply("Files in mediaCache: " + files.length);
    });
});

tgBot.command("port", (ctx) => {
    if (!chatId) {
        return;
    }

    ctx.reply("Port: " + PORT);
});

/**
 *
 * @params posts
 */
async function handleTelegramPost(posts = []) {
    if (chatId == null) {
        console.log("Telegram chat has not been set yet");
        return;
    }

    // Create arr of posts to use
    const tgPost = [];
    var attachmentsCounter = 0;
    for (let i = 0; i < posts.length; ++i) {
        tgPost.push({
            text: posts[i].text,
            attachments: posts[i].attachments,
            attachmentsLength: posts[i].attachments.length,
            attachmentsPath: Array(posts[i].attachments.length).fill(null),
        });

        attachmentsCounter += posts[i].attachments.length;
    }

    console.log("Attchm counter: " + attachmentsCounter);

    async function postToTelegram(p) {
        console.log(`Sending ${p} message...`);

        // Send message
        for (let i = 0; i < p.length; ++i) {
            try {
                if (p[i].text != "") {
                    await tgBot.telegram.sendMessage(chatId, p[i].text);
                }
            } catch (e) {
                console.log("Error tg message");
                try {
                    const inputString = e.error;
                    const regex = /retry after (\d+)/i;
                    const match = inputString.match(regex);
                    if (match) {
                        const retryAfterNumber = Number(match[1]);
                        i -= 1;
                        await sleep((retryAfterNumber + 1) * 1000);
                    }
                } catch (e) {
                    console.log("Error handling tg error message");
                    console.log(e);
                }
            }

            await sleep(3000);

            for (let j = 0; j < p[i].attachmentsLength; ++j) {
                try {
                    let ext = getFileExtension(p[i].attachmentsPath[j]);

                    switch (ext) {
                        case "mp4":
                            await tgBot.telegram.sendVideo(chatId, {
                                source: p[i].attachmentsPath[j],
                            });
                            break;

                        case "jpeg":
                            await tgBot.telegram.sendPhoto(chatId, {
                                source: p[i].attachmentsPath[j],
                            });
                            break;
                        case "png":
                            await tgBot.telegram.sendPhoto(chatId, {
                                source: p[i].attachmentsPath[j],
                            });
                            break;
                        case "jpg":
                            await tgBot.telegram.sendPhoto(chatId, {
                                source: p[i].attachmentsPath[j],
                            });
                            break;

                        default:
                            break;
                    }
                } catch (e) {
                    console.log("Error tg message");
                    try {
                        const inputString = e.error;
                        const regex = /retry after (\d+)/i;
                        const match = inputString.match(regex);
                        if (match) {
                            const retryAfterNumber = Number(match[1]);
                            i -= 1;
                            await sleep((retryAfterNumber + 1) * 1000);
                        }
                    } catch (e) {
                        console.log("Error handling tg error message");
                        console.log(e);
                    }
                }
            }

            await sleep(9000);
        }

        // Free attachments space after sending them
        for (let i = 0; i < p.length; ++i) {
            for (let j = 0; j < p[i].attachmentsLength; ++j) {
                if (p[i].attachmentsPath[j] == null) {
                    break;
                }

                let filePath = p[i].attachmentsPath[j];

                fs.unlink(filePath, (err) => {
                    if (err) {
                        console.error(
                            `Error deleting the file: ${err.message}`
                        );
                    } else {
                        console.log(
                            `File ${filePath} has been deleted successfully.`
                        );
                    }
                });
            }
        }

        return;
    }

    // Post to tg
    for (let i = 0; i < tgPost.length; ++i) {
        // Save images and exchange url with path to file
        for (let j = 0; j < tgPost[i].attachmentsLength; ++j) {
            let url = tgPost[i].attachments[j];
            let fileType = getFileExtension(url);
            let id = uuidv4();
            tgPost[i].attachmentsPath[j] = `${mediaCache}/${id}.${fileType}`;

            // Download video or image and store it
            const response = await axios.get(url, { responseType: "stream" });

            // Weights over 50MB
            const contentLength = response.headers["content-length"];
            const contentLengthMB = (contentLength / (1024 * 1024)).toFixed(2);
            if (contentLengthMB >= 50) {
                // Send url as you can't send too large files on tg
                tgPost[i].attachmentsPath[j] = null;
                attachmentsCounter -= 1;

                break;
            }

            const writer = fs.createWriteStream(
                `${mediaCache}/${id}.${fileType}`
            );

            await response.data.pipe(writer);

            writer.on("finish", async () => {
                console.log("Media downloaded successfully, closing stream.");

                attachmentsCounter -= 1;

                console.log(attachmentsCounter);
                if (attachmentsCounter == 0) {
                    console.log("All Videos downloaded successfully");
                    await postToTelegram(tgPost);
                }
            });
            writer.on("error", (err) => {
                console.error("Error downloading video:", err);
            });
        }
    }
}

/**
 * Launch bot
 */
tgBot.launch();

/**
 * main execution of the script
 */
const dbGAB = new dbGab();
const jobs = [];
var currentlyRunningRoutines = 0;
async function main() {
    if (chatId == null) {
        console.log("Telegram chat has not been set yet");
        isMainRunning = false;
        return res.sendStatus(500);
    }

    // Start browser
    await setupBrowserInterface();

    // Create routines
    for (let i = 0; i < gabAccounts.length; ++i) {
        if (i > 59) {
            jobs.push(
                await startGabAccountRoutine(
                    i - 59 * Math.floor(i / 59),
                    4,
                    gabAccounts[i],
                    false
                )
            );
            break;
        }
        jobs.push(await startGabAccountRoutine(i, 4, gabAccounts[i], false));
    }

    // Run routines
    for (let i = 0; i < jobs.length; ++i) {
        jobs[i].start();
    }

    return;
}

/**
 * Express Server
 */
app.get("/", async (req, res) => {
    if (currentlyRunningRoutines > 0) {
        console.log("Script is running...");
        return res.sendStatus(200);
    }

    console.log("Running script...");
    main();

    return res.sendStatus(200);
});

app.get("/status", async (req, res) => {
    return res.sendStatus(200);
});

/**
 * gracefulShutDown shuts down gracefully the app.
 * @param {string} code the shud down code
 */
async function gracefulShutDown(code) {
    console.log("Received kill signal, shutting down gracefully...");

    for (let i = 0; i < jobs.length; ++i) {
        jobs[i].stop();
    }

    tgBot.stop(code);

    server.close(() => {
        console.log("Closed out remaining connections");
        process.exit(0);
    });

    setTimeout(() => {
        console.error(
            "Could not close connections in time, forcefully shutting down"
        );
        process.exit(1);
    }, 10000);

    if (browser) {
        await browser.close();
        console.log("Closed out Browser session");
    }

    console.log("App shutted down gracefully...");
}
process.once("SIGINT", gracefulShutDown);
process.once("SIGTERM", gracefulShutDown);
process.once("SIGQUIT", gracefulShutDown);

const server = app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
