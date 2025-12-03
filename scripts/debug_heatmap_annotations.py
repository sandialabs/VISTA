#!/usr/bin/env python3
"""
Debug script to check heatmap annotations in the database
"""
import asyncio
import sys
import os
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env file in project root
project_root = Path(__file__).parent.parent
load_dotenv(project_root / '.env')

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from sqlalchemy import select
from core.database import async_engine, AsyncSession
from core.models import MLAnalysis, MLAnnotation
from sqlalchemy.orm import selectinload


async def check_annotations():
    """Check all heatmap annotations and their storage paths"""
    async with AsyncSession(async_engine) as db:
        # Get all ML analyses with their annotations
        stmt = select(MLAnalysis).options(selectinload(MLAnalysis.annotations))
        result = await db.execute(stmt)
        analyses = result.scalars().all()

        print(f"Found {len(analyses)} ML analyses\n")

        for analysis in analyses:
            print(f"Analysis ID: {analysis.id}")
            print(f"  Model: {analysis.model_name} v{analysis.model_version}")
            print(f"  Status: {analysis.status}")
            print(f"  Image ID: {analysis.image_id}")
            print(f"  Created: {analysis.created_at}")
            print(f"  Annotations: {len(analysis.annotations)}")

            for ann in analysis.annotations:
                print(f"\n    Annotation ID: {ann.id}")
                print(f"    Type: {ann.annotation_type}")
                print(f"    Storage Path: {ann.storage_path}")
                print(f"    Data: {ann.data}")

            print("\n" + "="*70 + "\n")


async def main():
    await check_annotations()
    await async_engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
