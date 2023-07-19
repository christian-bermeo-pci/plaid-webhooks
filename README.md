# Plaid Webhooks

### Overview

This is a starter app that is to be used with the Plaid and Webhooks [YouTube tutorial](https://www.youtube.com/watch?v=0E0KEAVeDyc). It implements a very basic version of a Plaid-powered application using HTML/VanillaJS on the front end, and NodeJS/Express on the backend.

### Running the app

- [ ] Clone the repo.
- [ ] Run `npm i`.
- [ ] Create `.env` like the `.env.template` and copy `PLAID_CLIENT_ID` & `PLAID_SECRET` from the Plaid Dashboard. `PLAID_ENV` should remain as sandbox.
- [ ] For the `WEBHOOK_URL` we can set this to anything to begin we can change this later.
- [ ] Run `npm run watch` it should start running on PORT 8000.

### Demo

#### Using webhook site to look at fired webhooks.

https://github.com/christian-bermeo-pci/plaid-webhooks/assets/113368520/27903c00-a541-43fa-9f92-398356fa1831

#### Logs:

![Screen Shot 2023-06-13 at 6 47 45 PM](https://github.com/christian-bermeo-pci/plaid-webhooks/assets/113368520/85b287cb-cd8d-4dbd-96da-03b11fffef49)

#### Resceiving webhook on localhost using ngrok

https://github.com/christian-bermeo-pci/plaid-webhooks/assets/113368520/4e5c4cce-1a04-484f-b71a-436945ca4157

#### Logs:

![Screen Shot 2023-06-13 at 6 52 47 PM](https://github.com/christian-bermeo-pci/plaid-webhooks/assets/113368520/f060ef14-4d60-4a42-8337-36e40dfd004c)

### Other links

- [Webhook site](https://webhook.site/): for watching webhooks.
- [ngrok](https://ngrok.com/download): for receiving plaid webhooks at our localhost:8000
- [Confluence page RFC](https://premierconsultingandintegration.atlassian.net/wiki/spaces/UI/pages/46661636/Plaid+Webhooks+for+Efficient+Data+Synchronization): PCI docs

### Webhook endpoint

`/server/receive_webhook`
