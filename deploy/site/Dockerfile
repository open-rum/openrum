FROM nginx:1.29-alpine
RUN chown -R nginx:nginx /var/cache/nginx /var/run /etc/nginx/conf.d
COPY apps/site/dist/ /usr/share/nginx/html/
COPY deploy/site/nginx-main.conf /etc/nginx/nginx.conf
COPY deploy/site/nginx.conf /etc/nginx/conf.d/default.conf
USER nginx
EXPOSE 8080
