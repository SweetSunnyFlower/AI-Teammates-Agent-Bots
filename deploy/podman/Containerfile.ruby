FROM docker.io/library/ruby:3.4-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends git bash ca-certificates build-essential nodejs npm python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/repo
