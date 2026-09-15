# WeCairn : PocketBase + hooks + interface web dans une seule image.
# Les données (SQLite, fichiers, sauvegardes) vivent dans le volume /pb/pb_data.
FROM alpine:3.21

ARG PB_VERSION=0.40.3
ARG TARGETARCH=amd64

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip -O /tmp/pb.zip \
 && unzip -q /tmp/pb.zip -d /pb && rm /tmp/pb.zip \
 && apk del unzip wget

COPY pocketbase/pb_hooks      /pb/pb_hooks
COPY pocketbase/pb_migrations /pb/pb_migrations
COPY pocketbase/pb_schema.json /pb/pb_schema.json
COPY web                   /pb/pb_public

WORKDIR /pb
EXPOSE 8090
VOLUME ["/pb/pb_data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8090/api/health || exit 1

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data", "--hooksDir=/pb/pb_hooks", "--migrationsDir=/pb/pb_migrations", "--publicDir=/pb/pb_public"]
