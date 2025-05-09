import { Request, Response } from "express";
import prisma from "../prisma/client";
import AWS from "aws-sdk";
import nodemailer from "nodemailer";

declare global {
  namespace Express {
    interface Request {
      file?: {
        originalname: string;
        mimetype: string;
        buffer: Buffer;
      };
      userId: number;
    }
  }
}

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const transporter = nodemailer.createTransport({
  host: "smtp.ethereal.email",
  port: 587,
  auth: {
    user: process.env.ETHEREAL_USER,
    pass: process.env.ETHEREAL_PASS,
  },
});

export const listMovies: any = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { search, page = 1, duration, startDate, endDate, genre } = req.query;
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ message: "Usuário não autenticado." });
  }

  const pageSize = 10;
  const skip = (Number(page) - 1) * pageSize;

  try {
    const filters: any = { userId };

    if (search) {
      filters.OR = [
        { title: { contains: String(search), mode: "insensitive" } },
        { originalTitle: { contains: String(search), mode: "insensitive" } },
      ];
    }

    if (duration) {
      filters.duration = { lte: Number(duration) };
    }

    if (startDate && endDate) {
      filters.releaseDate = {
        gte: new Date(String(startDate)),
        lte: new Date(String(endDate)),
      };
    }

    if (genre) {
      filters.genre = { contains: String(genre), mode: "insensitive" };
    }

    const movies = await prisma.movie.findMany({
      where: filters,
      skip,
      take: pageSize,
    });

    const totalMovies = await prisma.movie.count({ where: filters });

    return res.status(200).json({
      movies,
      totalMovies,
      totalPages: Math.ceil(totalMovies / pageSize),
      currentPage: Number(page),
    });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao listar filmes.", error });
  }
};

export const addOrEditMovie: any = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const {
    id,
    title,
    originalTitle,
    description,
    tagline,
    budget,
    revenue,
    popularity,
    voteCount,
    language,
    status,
    releaseDate,
    duration,
    genre,
    youtubeUrl,
    imageUrl: imageUrlFromBody,
  } = req.body;

  const file = req.file;

  if (!req.userId) {
    return res.status(401).json({ message: "Usuário não autenticado." });
  }

  try {
    let imageUrl = null;

    if (file) {
      // Se vier um arquivo (upload manual), sobe no S3
      const uploadResult = await s3
        .upload({
          Bucket: process.env.AWS_BUCKET_NAME!,
          Key: `movies/${Date.now()}_${file.originalname}`,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
        .promise();

      imageUrl = uploadResult.Location;
    } else if (imageUrlFromBody) {
      imageUrl = imageUrlFromBody;
    }

    const profit = Number(revenue) - Number(budget);
    const successRate = (Number(popularity) * Number(voteCount)) / 1000;

    const movieData = {
      title,
      originalTitle,
      description,
      tagline,
      budget: Number(budget),
      revenue: Number(revenue),
      popularity: Number(popularity),
      voteCount: Number(voteCount),
      language,
      status,
      releaseDate: new Date(releaseDate),
      duration: Number(duration),
      genre,
      youtubeUrl,
      imageUrl,
      profit,
      successRate,
      userId: req.userId,
    };

    let movie;
    if (id) {
      movie = await prisma.movie.update({
        where: { id: Number(id) },
        data: movieData,
      });
    } else {
      movie = await prisma.movie.create({
        data: movieData,
      });
    }

    return res.status(200).json({ message: "Filme salvo com sucesso!", movie });
  } catch (error) {
    console.error("Erro ao salvar filme:", error);
    return res.status(500).json({ message: "Erro ao salvar filme.", error });
  }
};

export const getMovieDetails: any = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ message: "Usuário não autenticado." });
  }

  try {
    const movie = await prisma.movie.findFirst({
      where: { id: Number(id), userId },
    });

    if (!movie) {
      return res.status(404).json({ message: "Filme não encontrado." });
    }

    return res.status(200).json(movie);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Erro ao buscar detalhes do filme.", error });
  }
};

export const deleteMovie: any = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ message: "Usuário não autenticado." });
  }

  try {
    const existingMovie = await prisma.movie.findFirst({
      where: { id: Number(id), userId },
    });

    if (!existingMovie) {
      return res.status(404).json({ message: "Filme não encontrado." });
    }

    await prisma.movie.delete({
      where: { id: Number(id) },
    });

    return res.status(200).json({ message: "Filme deletado com sucesso." });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao deletar filme.", error });
  }
};
