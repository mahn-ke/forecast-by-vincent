FROM node:26-alpine

WORKDIR /app
COPY ./ /app

RUN apk add --no-cache curl fontconfig \
    && mkdir -p /usr/local/share/fonts/fira-sans \
    && cp /app/fonts/*.ttf /usr/local/share/fonts/fira-sans/ \
    && fc-cache -f \
    && npm ci

CMD ["npm", "run", "start"]
