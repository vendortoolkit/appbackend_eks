ARG SERVICE_ROOT

FROM node:24-alpine

ARG SERVICE_ROOT
ENV APP_ROOT=/opt/nodejs \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app/public
COPY layers/ /opt/nodejs/layers/

RUN test -n "${SERVICE_ROOT}" \
    && case "${SERVICE_ROOT}" in \
      ebayApi) layers="awssdk core ebayapi" ;; \
      marketingApi) layers="awssdk core" ;; \
      paymentApi|userApi) layers="awssdk core stripe" ;; \
      *) echo "Unsupported SERVICE_ROOT: ${SERVICE_ROOT}" >&2; exit 1 ;; \
    esac \
    && for layer in $layers; do \
      npm install --omit=dev --prefix "/opt/nodejs/layers/${layer}"; \
    done \
    && ln -s layers/awssdk /opt/nodejs/awsSdk_module \
    && ln -s layers/core /opt/nodejs/core_module \
    && if [ -d /opt/nodejs/layers/ebayapi ] && [ "${SERVICE_ROOT}" = ebayApi ]; then \
      ln -s layers/ebayapi /opt/nodejs/ebayApi_module; \
    fi \
    && if [ -d /opt/nodejs/layers/stripe ] && { [ "${SERVICE_ROOT}" = paymentApi ] || [ "${SERVICE_ROOT}" = userApi ]; }; then \
      ln -s layers/stripe /opt/nodejs/stripe_module; \
    fi

COPY public/shared/ ./shared/
COPY public/${SERVICE_ROOT}/ ./${SERVICE_ROOT}/

RUN npm install --omit=dev --prefix "/app/public/${SERVICE_ROOT}" \
    && find "/app/public/${SERVICE_ROOT}" -mindepth 2 -name package.json \
      -not -path '*/node_modules/*' \
      -exec sh -c 'npm install --omit=dev --prefix "$(dirname "$1")"' _ {} \; \
    && chown -R node:node /app

WORKDIR /app/public/${SERVICE_ROOT}
USER node
EXPOSE 3000
CMD ["npm", "start"]
