from __future__ import annotations

from pydantic import BaseModel, EmailStr


class UserDto(BaseModel):
    id: int
    firstName: str
    lastName: str
    middleName: str | None = None
    groupNumber: str | None = None
    email: EmailStr
    phone: str | None = None


class IdentifyFoundResponse(BaseModel):
    found: bool = True
    user: UserDto
    score: float


class IdentifyNotFoundResponse(BaseModel):
    found: bool = False


class RegisterResponse(BaseModel):
    success: bool = True
    userId: int
    message: str


class DeleteUserResponse(BaseModel):
    success: bool = True
    message: str


class HealthResponse(BaseModel):
    status: str
    usersCount: int
    threshold: float
