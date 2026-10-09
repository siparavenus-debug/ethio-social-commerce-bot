import {
    describe,
    expect,
    it,
    vi
  } from "vitest";

  import {
    requirePlatformRole
  } from "../src/middleware/platform-auth.js";

  function createMockResponse() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };

    return res;
  }

  describe(
    "platform authorization middleware",
    () => {
      it(
        "rejects a request without an authenticated platform user",
        () => {
          const req = {} as any;
          const res =
            createMockResponse();
          const next = vi.fn();

          requirePlatformRole(
            "OWNER",
            "ADMIN"
          )(
            req,
            res as any,
            next
          );

          expect(
            res.status
          ).toHaveBeenCalledWith(401);

          expect(
            res.json
          ).toHaveBeenCalledWith({
            error:
              "Platform authentication required"
          });

          expect(
            next
          ).not.toHaveBeenCalled();
        }
      );

      it(
        "rejects a platform user whose role is not allowed",
        () => {
          const req = {
            platformAuth: {
              id:
                "platform-user-123",
              email:
                "staff@example.test",
              displayName:
                "Platform Staff",
              role:
                "STAFF",
              tokenVersion:
                0
            }
          } as any;

          const res =
            createMockResponse();
          const next = vi.fn();

          requirePlatformRole(
            "OWNER",
            "ADMIN"
          )(
            req,
            res as any,
            next
          );

          expect(
            res.status
          ).toHaveBeenCalledWith(403);

          expect(
            res.json
          ).toHaveBeenCalledWith({
            error:
              "You do not have permission to perform this platform action"
          });

          expect(
            next
          ).not.toHaveBeenCalled();
        }
      );

      it(
        "allows a platform user whose role is allowed",
        () => {
          const req = {
            platformAuth: {
              id:
                "platform-user-123",
              email:
                "admin@example.test",
              displayName:
                "Platform Admin",
              role:
                "ADMIN",
              tokenVersion:
                0
            }
          } as any;

          const res =
            createMockResponse();
          const next = vi.fn();

          requirePlatformRole(
            "OWNER",
            "ADMIN"
          )(
            req,
            res as any,
            next
          );

          expect(
            next
          ).toHaveBeenCalledTimes(1);

          expect(
            res.status
          ).not.toHaveBeenCalled();
        }
      );
    }
  );
