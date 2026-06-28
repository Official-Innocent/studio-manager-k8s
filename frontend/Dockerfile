FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Static frontend assets
COPY index.html /usr/share/nginx/html/index.html
COPY promo_banner.js /usr/share/nginx/html/promo_banner.js
COPY admin/ /usr/share/nginx/html/admin/
COPY portal/ /usr/share/nginx/html/portal/
COPY pipeline/ /usr/share/nginx/html/pipeline/
COPY documents/ /usr/share/nginx/html/documents/
COPY assets/ /usr/share/nginx/html/assets/
COPY gallery/ /usr/share/nginx/html/gallery/
COPY experience/ /usr/share/nginx/html/experience/
COPY wedding-photographer-northampton/ /usr/share/nginx/html/wedding-photographer-northampton/
COPY portrait-photographer-northampton/ /usr/share/nginx/html/portrait-photographer-northampton/
COPY maternity-photographer-northampton/ /usr/share/nginx/html/maternity-photographer-northampton/
COPY headshot-photographer-northampton/ /usr/share/nginx/html/headshot-photographer-northampton/
COPY event-photographer-northampton/ /usr/share/nginx/html/event-photographer-northampton/

EXPOSE 80
