# React + Vite SDK example

This app demonstrates OpenRUM page views, governed custom events, API timing and error capture.

Start the OpenRUM Alpha first, create a development project key under **设置 → 项目密钥**, then configure the example using its local environment file. Do not commit the key. From the repository root:

```sh
cp examples/react-vite/.env.example examples/react-vite/.env.local
pnpm --filter @openrum/example-react-vite dev
```

Open the URL printed by Vite and use the controls to emit data. The example is deliberately small and is not a production SDK configuration template.

The three buttons exercise the shipped singleton APIs and default automatic integrations. In the Console, open **事件** to find `demo_checkout`, **API** for `/demo-api`, and **错误** for `OpenRUM example error`; the same `session_id` connects them in **会话**.
