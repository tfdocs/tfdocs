export type URLAction = {
  type: 'url';
  url: string;
};

export type NavigateAction = {
  type: 'navigate';
  filePath: string;
};

export type Action = URLAction | NavigateAction;

export const RESOURCE_REGEX =
  /(data|resource)\s+"([a-zA-Z-]+)_([a-z0-9_]+)"\s+"([a-z0-9_]+)"/;
export const MODULE_REGEX = /(module)\s+"([a-zA-Z0-9_-]+)"/;
