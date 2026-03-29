export interface JclawPluginApi {
}

export interface JclawPluginEntry {
  id: string;
  name: string;
  description: string;
  register: (api: JclawPluginApi) => void;
  configSchema?: unknown;
}
