export interface UserDto {
  id: number;
  firstName: string;
  lastName: string;
  middleName?: string;
  groupNumber?: string;
  email: string;
  phone?: string;
}

export interface IdentifyFoundResponse {
  found: true;
  user: UserDto;
  score: number;
}

export interface IdentifyNotFoundResponse {
  found: false;
}

export type IdentifyResponse = IdentifyFoundResponse | IdentifyNotFoundResponse;

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
}

export interface RegisterResponse {
  success: boolean;
  userId: number;
  message: string;
}

export interface DeleteUserResponse {
  success: boolean;
  message: string;
}
