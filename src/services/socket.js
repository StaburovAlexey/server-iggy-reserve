const { Server } = require('socket.io');

let io;

function initSocket(server, { isProd, isOriginAllowed }) {
  io = new Server(server, {
    cors: isProd
      ? {
          origin: (origin, callback) => {
            if (isOriginAllowed(origin)) {
              return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
          },
        }
      : { origin: '*' },
  });

  io.on('connection', (socket) => {
    console.log('Socket connected', socket.id);
    socket.on('disconnect', () => {
      console.log('Socket disconnected', socket.id);
    });
  });
}

function emitSchemaUpdated(schema, updatedAt) {
  if (!io) return;
  io.emit('schema_updated', { schema, updated_at: updatedAt });
}

function emitTableCreated(table) {
  if (!io) return;
  io.emit('table_created', table);
}

function emitTableDeleted(id) {
  if (!io) return;
  io.emit('table_deleted', { id });
}

module.exports = {
  initSocket,
  emitSchemaUpdated,
  emitTableCreated,
  emitTableDeleted,
};
