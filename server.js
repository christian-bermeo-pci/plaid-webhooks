"use strict";
require("dotenv").config();
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const moment = require("moment");
const {
  Configuration,
  PlaidEnvironments,
  PlaidApi,
  SandboxItemFireWebhookRequestWebhookCodeEnum,
  WebhookType,
} = require("plaid");

// Auth/verification imports
const compare = require("secure-compare");
const jwt_decode = require("jwt-decode");
const JWT = require("jose");
const crypto = require("crypto");

const APP_PORT = process.env.APP_PORT || 8000;
const USER_DATA_FILE = "user_data.json";

const FIELD_ACCESS_TOKEN = "accessToken";
const FIELD_USER_STATUS = "userStatus";

let webhookUrl =
  process.env.WEBHOOK_URL || "https://www.example.com/server/plaid_webhook";

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(
  bodyParser.json({
    verify: function (req, res, buf, encoding) {
      const hash = crypto.createHash("sha256");
      hash.update(buf);
      req.hasha = hash.digest("hex");
      console.log("hash", req.hasha);

      req.rawBody = buf.toString();
      console.log("rawBody", req.rawBody);
    },
  })
);
app.use(express.static("public"));

const server = app.listen(APP_PORT, function () {
  console.log(`Server is up and running at http://localhost:${APP_PORT}/`);
});

// Set up the Plaid client
const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
      "Plaid-Version": "2020-09-14",
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

const getUserRecord = async function () {
  try {
    const userData = await fs.readFile(USER_DATA_FILE, {
      encoding: "utf8",
    });
    const userDataObj = await JSON.parse(userData);
    console.log(`Retrieved userData ${userData}`);
    return userDataObj;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("No user object found. We'll make one from scratch.");
      return null;
    }
    // Might happen first time, if file doesn't exist
    console.log("Got an error", error);
    return null;
  }
};

let userRecord;
(async () => {
  userRecord = await getUserRecord();
  if (userRecord == null) {
    userRecord = {};
    userRecord[FIELD_ACCESS_TOKEN] = null;
    userRecord[FIELD_USER_STATUS] = "disconnected";
  }
})();

/**
 * Updates the user record in memory and writes it to a file. In a real
 * application, you'd be writing to a database.
 */
const updateUserRecord = async function (key, val) {
  userRecord[key] = val;
  try {
    const dataToWrite = JSON.stringify(userRecord);
    await fs.writeFile(USER_DATA_FILE, dataToWrite, {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(`User record ${dataToWrite} written to file.`);
  } catch (error) {
    console.log("Got an error: ", error);
  }
};

/**
 * Just returns whether or not we're connected to Plaid
 */
app.get("/server/get_user_info", async (req, res, next) => {
  try {
    res.json({
      user_status: userRecord[FIELD_USER_STATUS],
    });
  } catch (error) {
    next(error);
  }
});

const basicLinkTokenObject = {
  user: { client_user_id: "testUser" },
  client_name: "Webhook Test App",
  language: "en",
  products: ["transactions", "assets"],
  country_codes: ["US"],
  webhook: webhookUrl,
};

/**
 * Generates a link token to be used by the client.
 */
app.post("/server/generate_link_token", async (req, res, next) => {
  try {
    const response = await plaidClient.linkTokenCreate(basicLinkTokenObject);
    console.log(basicLinkTokenObject);
    res.json(response.data);
  } catch (error) {
    console.log(`Running into an error!`);
    next(error);
  }
});

/**
 * Swap the public token for an access token, so we can access transaction info
 * in the future
 */
app.post("/server/swap_public_token", async (req, res, next) => {
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: req.body.public_token,
    });
    console.log(`You got back ${JSON.stringify(response.data)}`);
    await updateUserRecord(FIELD_ACCESS_TOKEN, response.data.access_token);
    await updateUserRecord(FIELD_USER_STATUS, "connected");

    res.json({ status: "success" });
  } catch (error) {
    next(error);
  }
});

/**
 * Grabs transaction info for the user and return it as a big ol' JSON object
 */
app.get("/server/transactions", async (req, res, next) => {
  try {
    const access_token = await userRecord[FIELD_ACCESS_TOKEN];
    const startDate = moment().subtract(30, "days").format("YYYY-MM-DD");
    const endDate = moment().format("YYYY-MM-DD");

    const transactionResponse = await plaidClient.transactionsGet({
      access_token: access_token,
      start_date: startDate,
      end_date: endDate,
      options: { count: 10 },
    });
    res.json(transactionResponse.data);
  } catch (error) {
    next(error);
  }
});

// Fetches balance data
app.get("/server/balances", async (req, res, next) => {
  try {
    const access_token = userRecord[FIELD_ACCESS_TOKEN];
    const balanceResponse = await plaidClient.accountsBalanceGet({
      access_token: access_token,
      options: {
        min_last_updated_datetime: "2020-01-01T00:00:00Z",
      },
    });
    res.json(balanceResponse.data);
  } catch (error) {
    next(error);
  }
});

/**
 * Kicks off the request to create an asset report. In non-sandbox mode
 * this could take several minutes to complete.
 */
app.get("/server/create_asset_report", async (req, res, next) => {
  try {
    const access_token = userRecord[FIELD_ACCESS_TOKEN];
    const reportResponse = await plaidClient.assetReportCreate({
      access_tokens: [access_token],
      days_requested: 30,
      options: {
        user: { first_name: "Jane", last_name: "Foster" },
        webhook: webhookUrl,
      },
    });
    res.json(reportResponse.data);
  } catch (error) {
    next(error);
  }
});

/**
 * Ask Plaid to fire off a new webhook. Useful for testing webhooks... and
 * not much else.
 */
app.post("/server/fire_test_webhook", async (req, res, next) => {
  try {
    const fireTestWebhook = await plaidClient.sandboxItemFireWebhook({
      access_token: userRecord[FIELD_ACCESS_TOKEN],
      webhook_code: "DEFAULT_UPDATE",
    });

    res.json(fireTestWebhook.data);
  } catch (error) {
    next(error);
  }
});

/**
 * Tell Plaid to use a new URL for our webhooks
 */
app.post("/server/update_webhook", async (req, res, next) => {
  try {
    webhookUrl = req.body.newUrl;
    const access_token = userRecord[FIELD_ACCESS_TOKEN];

    const updateWebhook = await plaidClient.itemWebhookUpdate({
      access_token: access_token,
      webhook: webhookUrl,
    });

    res.json(updateWebhook.data);
  } catch (error) {
    next(error);
  }
});

// Cache for webhook validation keys.
const KEY_CACHE = new Map();

/**
 * Plaid Webhook Verification
 */
const verify = async (body, headers) => {
  const signedJwt = headers["plaid-verification"];
  const decodedToken = jwt_decode(signedJwt);
  // Extract the JWT Header
  const decodedTokenHeader = jwt_decode(signedJwt, { header: true });
  // Extract the kid value from the header
  const currentKeyID = decodedTokenHeader.kid;

  // If key not in cache, update the key cache
  if (!KEY_CACHE.has(currentKeyID)) {
    const keyIDsToUpdate = [];
    KEY_CACHE.forEach((keyID, key) => {
      // We will also want to refresh any not-yet-expired keys
      if (key.expired_at == null) {
        keyIDsToUpdate.push(keyID);
      }
    });

    keyIDsToUpdate.push(currentKeyID);

    for (const keyID of keyIDsToUpdate) {
      const response = await plaidClient
        .webhookVerificationKeyGet({
          key_id: keyID,
        })
        .catch((err) => {
          console.log("ERROR");
          console.error(err);
          // decide how you want to handle unexpected API errors,
          // e.g. retry later
          return false;
        });
      const key = response.data.key;
      KEY_CACHE.set(keyID, key);
    }
  }

  // If the key ID is not in the cache, the key ID may be invalid.
  if (!KEY_CACHE.has(currentKeyID)) {
    return false;
  }

  // Fetch the current key from the cache.
  const key = KEY_CACHE.get(currentKeyID);

  // Reject expired keys.
  if (key.expired_at != null) {
    return false;
  }

  // Validate the signature and iat
  try {
    const keyLike = await JWT.importJWK(key);
    // This will throw an error if verification fails
    const { payload } = await JWT.jwtVerify(signedJwt, keyLike, {
      maxTokenAge: "5 min",
    });
  } catch (error) {
    return false;
  }

  // Compare hashes.
  const claimedBodyHash = decodedToken.request_body_sha256;
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(body, null, 2));
  const bodyHash = hash.digest("hex");
  return compare(bodyHash, claimedBodyHash);
};

/**
 * We've received a webhook! We should probably so something with it.
 */
app.post(
  "/server/receive_webhook",
  async (req, res, next) => {
    const ip = req.headers["x-forwarded-for"];
    console.log(`The client's IP Address is: ${ip}`);
    // NOTE: IPs are subject to change
    const allowlist = [
      "52.21.26.131",
      "52.21.47.157",
      "52.41.247.19",
      "52.88.82.239",
    ];
    if (!allowlist.includes(ip)) {
      res.status(401).send({ message: "Unauthorized" });
    }
    const response = await verify(req.body, req.headers);
    if (response) {
      next();
    } else {
      res.status(401).send({ message: "Unauthorized" });
    }
  },
  async (req, res, next) => {
    try {
      console.log("this is the webhook response");
      //console.dir(req.body, { depth: null, colors: true });

      const product = req.body.webhook_type;
      /** Webhook codes depend on the product */
      const code = req.body.webhook_code;

      switch (product) {
        case WebhookType.Item:
          handleItemWebhook(code, req.body);
          break;
        case WebhookType.Transactions:
          handleTransactionsWebhook(code, req.body);
          break;
        case WebhookType.Assets:
          handleAssetsWebhook(code, req.body);
          break;
        default:
          console.log(`Can't handle webhook product ${product}`);
          break;
      }

      res.json({ status: "received" });
    } catch (error) {
      next(error);
    }
  }
);

function handleItemWebhook(code, requestBody) {
  switch (code) {
    case "ERROR":
      console.log(
        `I received this error: ${requestBody.error.error_message}| should probably ask this user to connect to their bank`
      );
      break;
    case "NEW_ACCOUNTS_AVAILABLE":
      console.log(
        `There are new accounts available at this Financial Institution! (Id: ${requestBody.item_id}) We might want to ask the user to share them with us`
      );
      break;
    case "PENDING_EXPIRATION":
      console.log(
        `We should tell our user to reconnect their bank with Plaid so there's no disruption to their service`
      );
      break;
    case "USER_PERMISSION_REVOKED":
      console.log(
        `The user revoked access to this item. We should remove it from our records`
      );
      break;
    case "WEBHOOK_UPDATE_ACKNOWLEDGED":
      console.log(`Hooray! You found the right spot!`);
      break;
    default:
      console.log(`Can't handle webhook code ${code}`);
      break;
  }
}

function handleTransactionsWebhook(code, requestBody) {
  switch (code) {
    case "INITIAL_UPDATE":
      console.log(
        `First patch of transactions are done. There's ${requestBody.new_transactions} available`
      );
      break;
    case "HISTORICAL_UPDATE":
      console.log(
        `Historical transactions are done. There's ${requestBody.new_transactions} available`
      );
      break;
    case "DEFAULT_UPDATE":
      console.log(
        `New data is here! There's ${requestBody.new_transactions} available`
      );
      break;
    case "TRANSACTIONS_REMOVED":
      console.log(
        `Looks like a few transactions have been reversed and should be removed from our records`
      );
      break;
    case "SYNC_UPDATES_AVAILABLE":
      console.log(
        "There are new updates available for the Transactions Sync API"
      );
      break;
    default:
      console.log(`Can't handle webhook code ${code}`);
      break;
  }
}

function handleAssetsWebhook(code, requestBody) {
  switch (code) {
    case "PRODUCT_READY":
      console.log(
        `Looks like asset report ${requestBody.asset_report_id} is ready to download`
      );
      break;
    case "ERROR":
      console.log(
        `I had an error generating this report: ${requestBody.error.error_message}`
      );
      break;
    default:
      console.log(`Can't handle webhook code ${code}`);
      break;
  }
}

const errorHandler = function (err, req, res, next) {
  console.error(`Your error:`);
  console.error(err);
  if (err.response?.data != null) {
    res.status(500).send(err.response.data);
  } else {
    res.status(500).send({
      error_code: "OTHER_ERROR",
      error_message: "I got some other message on the server.",
    });
  }
};
app.use(errorHandler);
