USE bigstret;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'eventos'
        AND COLUMN_NAME = 'latitude_evento') = 0,
    'ALTER TABLE eventos ADD COLUMN latitude_evento DECIMAL(11,8) NULL AFTER cep_evento',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'eventos'
        AND COLUMN_NAME = 'longitude_evento') = 0,
    'ALTER TABLE eventos ADD COLUMN longitude_evento DECIMAL(11,8) NULL AFTER latitude_evento',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'evento_participantes_guest') = 0,
    'CREATE TABLE evento_participantes_guest (
        id_guest INT PRIMARY KEY AUTO_INCREMENT,
        id_evento INT NOT NULL,
        nome_guest VARCHAR(100) NOT NULL,
        nome VARCHAR(100) NULL,
        cpf BIGINT NULL,
        idade INT NULL,
        peso FLOAT NULL,
        altura FLOAT NULL,
        data_inscricao TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_evento_participantes_guest_evento
            FOREIGN KEY (id_evento) REFERENCES eventos(id_evento)
            ON DELETE CASCADE
    )',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'evento_participantes_guest'
        AND COLUMN_NAME = 'nome') = 0,
    'ALTER TABLE evento_participantes_guest ADD COLUMN nome VARCHAR(100) NULL AFTER nome_guest',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'evento_participantes_guest'
        AND COLUMN_NAME = 'cpf') = 0,
    'ALTER TABLE evento_participantes_guest ADD COLUMN cpf BIGINT NULL AFTER nome',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'evento_participantes_guest'
        AND COLUMN_NAME = 'idade') = 0,
    'ALTER TABLE evento_participantes_guest ADD COLUMN idade INT NULL AFTER cpf',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'evento_participantes_guest'
        AND COLUMN_NAME = 'peso') = 0,
    'ALTER TABLE evento_participantes_guest ADD COLUMN peso FLOAT NULL AFTER idade',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = IF(
    (SELECT COUNT(*)
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'evento_participantes_guest'
        AND COLUMN_NAME = 'altura') = 0,
    'ALTER TABLE evento_participantes_guest ADD COLUMN altura FLOAT NULL AFTER peso',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE evento_participantes_guest
   SET nome = COALESCE(NULLIF(nome, ''), nome_guest)
 WHERE (nome IS NULL OR nome = '')
   AND nome_guest IS NOT NULL;

DELETE FROM evento_participantes_guest;
DELETE FROM evento_participantes;
DELETE FROM eventos;

ALTER TABLE evento_participantes_guest AUTO_INCREMENT = 1;
ALTER TABLE evento_participantes AUTO_INCREMENT = 1;
ALTER TABLE eventos AUTO_INCREMENT = 1;

INSERT INTO eventos (
    nome_evento,
    tipo,
    faixa_etaria,
    genero,
    esporte_evento,
    descricao_evento,
    data_evento,
    horario_inicio,
    horario_termino,
    max_jogadorees,
    qtd_times,
    jogadores_time,
    valor_aluguel,
    horas_aluguel,
    pix,
    beneficiario,
    banco,
    rua_evento,
    numero_evento,
    cidade_evento,
    bairro_evento,
    cep_evento,
    latitude_evento,
    longitude_evento,
    codigo_convite,
    usuario_id,
    quadra_id
) VALUES
    ('Pelada do Horto', 'Quadra publica', '16+', 'misto', 'Futebol', 'Racha regional em Betim com ponto de encontro na Rua Jose de Alencar.', '2026-03-28', '2026-03-28 08:00:00', '2026-03-28 10:00:00', 14, 2, 7, 0.00, 1, '', '', '', 'Rua Jose de Alencar', 0, 'Betim', 'Regional Sede', '32655040', -19.97468220, -44.17836710, 'HRT01', 1, NULL),
    ('Basquete na Praca', 'Quadra publica', '14+', 'misto', 'Basquete', '3x3 aberto na Praca Milton Campos com rotacao rapida de times.', '2026-03-29', '2026-03-29 17:00:00', '2026-03-29 19:00:00', 10, 2, 5, 0.00, 1, '', '', '', 'Praca Milton Campos', 0, 'Betim', 'Regional Sede', '32600134', -19.97202920, -44.19412600, 'PRC02', 2, NULL),
    ('Volei de Areia', 'Quadra publica', '16+', 'misto', 'Volei', 'Partida na orla da Pampulha com encontro pela Avenida Otacilio Negrao de Lima.', '2026-04-02', '2026-04-02 07:30:00', '2026-04-02 09:30:00', 12, 2, 6, 0.00, 1, '', '', '', 'Avenida Otacilio Negrao de Lima', 1350, 'Belo Horizonte', 'Sao Luiz', '31310082', -19.85338280, -43.97478510, 'PAM03', 2, NULL),
    ('Treino Aberto', 'Quadra publica', 'Livre', 'misto', 'Corrida', 'Treino funcional e corrida leve com encontro na Praca da Liberdade.', '2026-04-04', '2026-04-04 06:30:00', '2026-04-04 08:00:00', 30, 1, 1, 0.00, 1, '', '', '', 'Praca da Liberdade', 0, 'Belo Horizonte', 'Savassi', '30140140', -19.93187220, -43.93804100, 'LIB04', 1, NULL),
    ('Futsal de Domingo', 'Quadra publica', '16+', 'misto', 'Futebol', 'Pelada de domingo em Contagem com concentracao na Avenida Joao Cesar de Oliveira.', '2026-04-05', '2026-04-05 09:00:00', '2026-04-05 11:00:00', 12, 2, 6, 0.00, 1, '', '', '', 'Avenida Joao Cesar de Oliveira', 0, 'Contagem', 'Eldorado', '32315040', -19.94129120, -44.04278200, 'CTG05', 2, NULL);
