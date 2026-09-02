// Postman Collection v2.1 types

export interface PostmanCollection {
  info: PostmanInfo;
  item: PostmanItem[];
  variable?: PostmanVariable[];
  event?: PostmanEvent[];
}

export interface PostmanInfo {
  name: string;
  _postman_id?: string;
  description?: string;
  schema: string;
}

export interface PostmanItem {
  name: string;
  id?: string;
  request?: PostmanRequest;
  item?: PostmanItem[]; // Folders contain nested items
  event?: PostmanEvent[];
}

export interface PostmanRequest {
  method: string;
  url: PostmanUrl | string;
  header?: PostmanHeader[];
  body?: PostmanBody;
  auth?: PostmanAuth;
  description?: string;
}

export interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: PostmanQuery[];
  variable?: PostmanVariable[];
}

export interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

export interface PostmanQuery {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

export interface PostmanBody {
  mode: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  urlencoded?: PostmanUrlEncodedParam[];
  formdata?: PostmanFormDataParam[];
  graphql?: PostmanGraphQL;
  options?: {
    raw?: {
      language?: string;
    };
  };
}

export interface PostmanUrlEncodedParam {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

export interface PostmanFormDataParam {
  key: string;
  value?: string;
  src?: string;
  type?: 'text' | 'file';
  disabled?: boolean;
  description?: string;
}

export interface PostmanGraphQL {
  query?: string;
  variables?: string;
}

export interface PostmanVariable {
  key: string;
  value?: string;
  type?: string;
  description?: string;
  disabled?: boolean;
}

export interface PostmanEvent {
  listen: 'prerequest' | 'test';
  script: PostmanScript;
}

export interface PostmanScript {
  type?: string;
  exec?: string[];
  id?: string;
}

export interface PostmanAuth {
  type: string;
  bearer?: PostmanAuthParam[];
  basic?: PostmanAuthParam[];
  apikey?: PostmanAuthParam[];
  [key: string]: unknown;
}

export interface PostmanAuthParam {
  key: string;
  value: string;
  type?: string;
}

// Flattened request for easier processing
export interface FlattenedRequest {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  queryParams: Record<string, string>;
  body?: {
    mode: string;
    content: string | Record<string, string>;
  };
  preRequestScript?: string[];
  testScript?: string[];
}
