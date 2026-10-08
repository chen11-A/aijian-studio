import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProviderConnectionForm } from "@qa-form/ProviderConnectionForm.tsx";

const PUBLIC_ORIGIN = "https://gateway.example.net";
const BUSINESS_KEY = "business-key-example-123";

function mount() {
  const onSubmit = vi.fn(async () => {});
  render(React.createElement(ProviderConnectionForm, {
    busy: false, error: null, onSubmit,
  }));
  return { onSubmit, form: document.querySelector("#new-provider-connection") };
}
function choose(name) {
  fireEvent.click(screen.getByRole("button", { name }));
}
function urlInput() {
  return document.querySelector('form#new-provider-connection input[type="url"]');
}
function keyInput() {
  return document.querySelector('form#new-provider-connection input[type="password"]');
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
}
afterEach(() => cleanup());

test("SUB2API requires a user-entered origin and business key before a TEXT connection is submitted", async () => {
  const { form, onSubmit } = mount();
  choose(/SUB2API/i);
  const origin = urlInput();
  const key = keyInput();
  expect(origin).not.toBeNull();
  expect(key).not.toBeNull();
  expect(origin.value).toBe("");
  expect(origin.required).toBe(true);
  expect(key.value).toBe("");
  expect(key.required).toBe(true);
  fireEvent.change(screen.getByLabelText(/剧本|文本/), { target: { value: "text-model-v1" } });
  expect(form.checkValidity()).toBe(false);
  save();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(origin, { target: { value: PUBLIC_ORIGIN } });
  expect(form.checkValidity()).toBe(false);
  save();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(key, { target: { value: BUSINESS_KEY } });
  expect(form.checkValidity()).toBe(true);
  save();
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    provider_kind: "SUB2API", base_url: PUBLIC_ORIGIN, api_key: BUSINESS_KEY,
    models: [{ model_id: "text-model-v1", capabilities: ["TEXT"] }],
  });
});

test("SUB2API clears prior non-TEXT models and does not offer non-TEXT submission", async () => {
  const { onSubmit } = mount();
  fireEvent.change(screen.getByLabelText(/角色|场景图片/), { target: { value: "image-model-v1" } });
  choose(/SUB2API/i);
  for (const label of [/角色|场景图片/, /镜头视频/, /配音/]) {
    const field = screen.queryByLabelText(label);
    if (field) expect(field.disabled).toBe(true);
  }
  fireEvent.change(urlInput(), { target: { value: PUBLIC_ORIGIN } });
  fireEvent.change(keyInput(), { target: { value: BUSINESS_KEY } });
  save();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/剧本|文本/), { target: { value: "text-only-v1" } });
  save();
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0][0].models).toEqual([
    { model_id: "text-only-v1", capabilities: ["TEXT"] },
  ]);
});

test("OLLAMA retains local preset, optional key, and IMAGE capability", async () => {
  const { onSubmit } = mount();
  choose(/Ollama 本地/i);
  expect(urlInput().value).toBe("http://127.0.0.1:11434/v1");
  expect(keyInput().required).toBe(false);
  fireEvent.change(screen.getByLabelText(/角色|场景图片/), { target: { value: "local-image-v1" } });
  save();
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    provider_kind: "OLLAMA", base_url: "http://127.0.0.1:11434/v1",
    models: [{ model_id: "local-image-v1", capabilities: ["IMAGE"] }],
  });
  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("api_key");
});

test("OPENAI retains its preset endpoint and required key", async () => {
  const { onSubmit } = mount();
  expect(urlInput().value).toBe("https://api.openai.com/v1");
  expect(keyInput().required).toBe(true);
  fireEvent.change(screen.getByLabelText(/剧本|文本/), { target: { value: "openai-text-v1" } });
  save();
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(keyInput(), { target: { value: "openai-key-example-123" } });
  save();
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    provider_kind: "OPENAI", base_url: "https://api.openai.com/v1",
    models: [{ model_id: "openai-text-v1", capabilities: ["TEXT"] }],
  });
});
