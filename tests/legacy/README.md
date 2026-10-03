# Legacy tests

These tests were written for older layouts (0.4.2–0.7.2) and fail against the 1.0.0-rc.8 compact studio because the elements they look for no longer exist. `studio-070.cjs` is superseded by `studio-071.cjs`, which covers the same retry rules plus the later Twitch scope check.

`npm test` does not run them. Keep them as a reference for behaviour worth porting into current tests.
