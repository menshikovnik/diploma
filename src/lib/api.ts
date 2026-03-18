import type {
  DeleteUserResponse,
  IdentifyResponse,
  RegisterPayload,
  RegisterResponse,
} from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';

const buildUrl = (path: string): string => {
  if (!API_BASE_URL) {
    return path;
  }

  return `${API_BASE_URL.replace(/\/$/, '')}${path}`;
};

const parseError = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as {
      message?: string;
      detail?: string | { message?: string };
    };

    if (data.message) {
      return data.message;
    }

    if (typeof data.detail === 'string') {
      return data.detail;
    }

    if (data.detail && typeof data.detail === 'object' && data.detail.message) {
      return data.detail.message;
    }
  } catch {
    return `Request failed with status ${response.status}`;
  }

  return `Request failed with status ${response.status}`;
};

export const identifyUser = async (file: Blob): Promise<IdentifyResponse> => {
  const formData = new FormData();
  formData.append('file', file, 'face-capture.jpg');

  const response = await fetch(buildUrl('/api/recognition/identify'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as IdentifyResponse;
};

export const registerUser = async (
  file: Blob,
  payload: RegisterPayload,
): Promise<RegisterResponse> => {
  const formData = new FormData();
  formData.append('file', file, 'face-capture.jpg');
  formData.append('firstName', payload.firstName);
  formData.append('lastName', payload.lastName);
  formData.append('email', payload.email);

  const response = await fetch(buildUrl('/api/recognition/register'), {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as RegisterResponse;
};

export const deleteUser = async (userId: number): Promise<DeleteUserResponse> => {
  const response = await fetch(buildUrl(`/api/recognition/users/${userId}`), {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as DeleteUserResponse;
};
