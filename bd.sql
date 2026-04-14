CREATE TABLE IF NOT EXISTS usuario (
    id_usuario INT PRIMARY KEY AUTO_INCREMENT,
    nome_user VARCHAR(100) NOT NULL,
    cpf BIGINT(11) NOT NULL UNIQUE,
    data_nascimento DATE NOT NULL,
    peso FLOAT NOT NULL,
    altura FLOAT NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    senha VARCHAR(16) NOT NULL,
    cep BIGINT(8) NOT NULL,
    rua_user VARCHAR(100),
    bairro_user VARCHAR(100),
    cidade_user VARCHAR(100) NOT NULL,
    uf_user VARCHAR(100) NOT NULL,
    latitude FLOAT,
    longitude FLOAT,
    avaliacao FLOAT
);

CREATE TABLE IF NOT EXISTS quadra (
    id_quadra INT PRIMARY KEY AUTO_INCREMENT,
    nome_quadra VARCHAR(100) NOT NULL,
    rua_quadra VARCHAR(100) NOT NULL,
    numero_quadra VARCHAR(100) NOT NULL,
    cidade_quadra VARCHAR(100) NOT NULL,
    bairro_quadra VARCHAR(100) NOT NULL,
    cep_quadra VARCHAR(8) NOT NULL,
    estado_quadra VARCHAR(100) NOT NULL,
    superficie VARCHAR(100) NOT NULL DEFAULT 'Concreto',
    esporte_quadra VARCHAR(250) NOT NULL,
    capacidade INT NOT NULL,
    usuario_id INT,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id_usuario)
);

CREATE TABLE IF NOT EXISTS eventos (
    id_evento INT PRIMARY KEY AUTO_INCREMENT,
    nome_evento VARCHAR(100) NOT NULL,
    tipo ENUM('Quadra publica', 'Quadra Alugada') NOT NULL,
    faixa_etaria VARCHAR(100) NOT NULL,
    genero ENUM('misto', 'feminino', 'masculino'),
    esporte_evento ENUM('Volei', 'Futebol', 'Basquete', 'Tenis', 'Corrida') NOT NULL,
    descricao_evento VARCHAR(150),
    data_evento DATE,
    horario_inicio TIMESTAMP NOT NULL,
    horario_termino TIMESTAMP NOT NULL,
    max_jogadorees INT,
    qtd_times INT,
    jogadores_time INT,
    valor_aluguel DECIMAL(10,2),
    horas_aluguel INT,
    pix VARCHAR(150),
    beneficiario VARCHAR(150),
    banco VARCHAR(50),
    rua_evento VARCHAR(100) NOT NULL DEFAULT '',
    numero_evento INT NOT NULL DEFAULT 0,
    cidade_evento VARCHAR(100) NOT NULL,
    bairro_evento VARCHAR(100) NOT NULL,
    cep_evento VARCHAR(8) NOT NULL DEFAULT '0',
    codigo_convite VARCHAR(5),
    usuario_id INT NOT NULL,
    quadra_id INT,
    FOREIGN KEY (quadra_id) REFERENCES quadra(id_quadra),
    FOREIGN KEY (usuario_id) REFERENCES usuario(id_usuario)
);

CREATE TABLE IF NOT EXISTS usuario_esportes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    usuario_id INT NOT NULL,
    esporte VARCHAR(100) NOT NULL,
    posicao VARCHAR(100),
    observacao TEXT,
    FOREIGN KEY (usuario_id) REFERENCES usuario(id_usuario)
);

insert into usuario (nome_user, cpf, data_nascimento,peso,altura, email,senha,cep,rua_user,bairro_user,cidade_user,uf_user,latitude,longitude,avaliacao) values ("Andey", 14261668696, "2009-04-11", 4, 5, "andrey@gmail.com", "Ramozin1!",
32671382, "rua", "bairro", "cidade", "uf", 1, 1, 1); 

USE bigstret;
drop table eventos;
drop database bigstret;
TRUNCATE TABLE usuario;
select * from eventos;
select * from quadra;
select * from usuario;