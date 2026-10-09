import type {
    NextFunction,
    Request,
    Response
} from "express";

import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from "vitest";

import { prisma } from "@ethio-commerce/database";

import {
    createAuthToken
} from "../services/auth.js";

import {
    createPlatformAuthToken
} from "../services/platform-auth.js";

import {
    requirePlatformAuth
} from "./platform-auth.js";

vi.mock(
    "@ethio-commerce/database",
    () => ({
        prisma: {
            platformUser: {
                findUnique: vi.fn()
            }
        }
    })
);

type MockResponse = Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
};

function createRequest(
    token?: string
): Request {
    return {
        get: vi.fn(
            (header: string) => {
                if (
                    header.toLowerCase() ===
                    "authorization" &&
                    token
                ) {
                    return `Bearer ${token}`;
                }

                return undefined;
            }
        )
    } as unknown as Request;
}

function createResponse(): MockResponse {
    const res = {
        status: vi.fn(),
        json: vi.fn()
    } as unknown as MockResponse;

    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);

    return res;
}

const findPlatformUser =
    vi.mocked(
        prisma.platformUser.findUnique
    );

describe(
    "requirePlatformAuth",
    () => {
        beforeEach(() => {
            vi.clearAllMocks();
        });

        it(
            "returns 401 when authentication is missing",
            async () => {
                const req = createRequest();
                const res = createResponse();
                const next =
                    vi.fn() as NextFunction;

                await requirePlatformAuth(
                    req,
                    res,
                    next
                );

                expect(
                    res.status
                ).toHaveBeenCalledWith(401);

                expect(next).not.toHaveBeenCalled();

                expect(
                    findPlatformUser
                ).not.toHaveBeenCalled();
            }
        );

        it(
            "returns 401 for an invalid token",
            async () => {
                const req =
                    createRequest(
                        "not-a-valid-token"
                    );

                const res = createResponse();
                const next =
                    vi.fn() as NextFunction;

                await requirePlatformAuth(
                    req,
                    res,
                    next
                );

                expect(
                    res.status
                ).toHaveBeenCalledWith(401);

                expect(next).not.toHaveBeenCalled();

                expect(
                    findPlatformUser
                ).not.toHaveBeenCalled();
            }
        );

        for (
            const role of [
                "OWNER",
                "ADMIN",
                "STAFF"
            ]
        ) {
            it(
                `returns 403 for a valid merchant ${role} token`,
                async () => {
                    const merchantToken =
                        createAuthToken({
                            id:
                                `merchant-user-${role}`,
                            merchantId:
                                "merchant-1",
                            role,
                            tokenVersion: 0
                        });

                    const req =
                        createRequest(
                            merchantToken
                        );

                    const res =
                        createResponse();

                    const next =
                        vi.fn() as NextFunction;

                    await requirePlatformAuth(
                        req,
                        res,
                        next
                    );

                    expect(
                        res.status
                    ).toHaveBeenCalledWith(
                        403
                    );

                    expect(
                        next
                    ).not.toHaveBeenCalled();

                    expect(
                        findPlatformUser
                    ).not.toHaveBeenCalled();
                }
            );
        }

        it(
            "returns 401 when the platform user no longer exists",
            async () => {
                const token =
                    createPlatformAuthToken({
                        id: "platform-user-1",
                        tokenVersion: 0
                    });

                findPlatformUser.mockResolvedValueOnce(
                    null
                );

                const req =
                    createRequest(token);

                const res =
                    createResponse();

                const next =
                    vi.fn() as NextFunction;

                await requirePlatformAuth(
                    req,
                    res,
                    next
                );

                expect(
                    res.status
                ).toHaveBeenCalledWith(401);

                expect(next).not.toHaveBeenCalled();
            }
        );

        it(
            "returns 401 when tokenVersion has changed",
            async () => {
                const token =
                    createPlatformAuthToken({
                        id: "platform-user-1",
                        tokenVersion: 2
                    });

                findPlatformUser.mockResolvedValueOnce({
                    id: "platform-user-1",
                    email:
                        "admin@example.com",
                    passwordHash:
                        "unused-in-middleware-test",
                    displayName:
                        "Platform Admin",
                    role: "ADMIN",
                    tokenVersion: 3,
                    createdAt:
                        new Date("2026-01-01T00:00:00.000Z"),
                    updatedAt:
                        new Date("2026-01-01T00:00:00.000Z")
                });

                const req =
                    createRequest(token);

                const res =
                    createResponse();

                const next =
                    vi.fn() as NextFunction;

                await requirePlatformAuth(
                    req,
                    res,
                    next
                );

                expect(
                    res.status
                ).toHaveBeenCalledWith(401);

                expect(next).not.toHaveBeenCalled();
            }
        );

        it(
            "authenticates a current platform user",
            async () => {
                const token =
                    createPlatformAuthToken({
                        id: "platform-user-1",
                        tokenVersion: 4
                    });

                findPlatformUser.mockResolvedValueOnce({
                    id: "platform-user-1",
                    email:
                        "admin@example.com",
                    passwordHash:
                        "unused-in-middleware-test",
                    displayName:
                        "Platform Admin",
                    role: "ADMIN",
                    tokenVersion: 4,
                    createdAt:
                        new Date("2026-01-01T00:00:00.000Z"),
                    updatedAt:
                        new Date("2026-01-01T00:00:00.000Z")
                });

                const req =
                    createRequest(token);

                const res =
                    createResponse();

                const next =
                    vi.fn() as NextFunction;

                await requirePlatformAuth(
                    req,
                    res,
                    next
                );

                expect(
                    res.status
                ).not.toHaveBeenCalled();

                expect(next).toHaveBeenCalledTimes(1);

                expect(
                    req.platformAuth
                ).toEqual({
                    id: "platform-user-1",
                    email:
                        "admin@example.com",
                    displayName:
                        "Platform Admin",
                    role: "ADMIN",
                    tokenVersion: 4
                });
            }
        );
    }
);