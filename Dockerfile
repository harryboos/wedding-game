FROM node:22-alpine AS build
WORKDIR /app
COPY scripts/build.mjs scripts/build.mjs
COPY public/ public/
RUN node scripts/build.mjs

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
