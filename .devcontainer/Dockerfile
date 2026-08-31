FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# psql and friends, so `prisma migrate` and manual poking both work in-container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# gh, so Claude can open PRs and read CI status from inside the container.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*

# docker-compose.yml mounts a named volume over /workspace/node_modules. Docker
# initialises an empty named volume from the image's directory at that path, so
# create it owned by `node` — otherwise the volume comes up root-owned and
# `npm ci` fails with EACCES, since postCreateCommand runs as the remote user.
RUN mkdir -p /workspace/node_modules && chown node:node /workspace/node_modules
